const core = require('@actions/core');
const s3 = require('aws-sdk/clients/s3');
const fs = require('fs');
const path = require('path');
const filesize = require('filesize');
const minimatch = require("minimatch");

const AWS_ACCESS_KEY_ID = core.getInput('aws_access_key_id', {
  required: true
});
const AWS_SECRET_ACCESS_KEY = core.getInput('aws_secret_access_key', {
  required: true
});
const BUCKET = core.getInput('bucket', {
  required: true
});
const PREFIX = core.getInput('prefix', {
  required: false
});
const REGION = core.getInput('region', {
  required: false
});
const EXCLUDE = core.getInput('exclude', {
  required: false
});
const OUTPUT_FILE = core.getInput('output_file', {
  required: true
});
const HEADER_DEPTH = core.getInput('header_depth', {
  required: false
});
const DL_HELPER = core.getInput('dl_helper', {
  required: false
});

var clientparams = {
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY
};

if (REGION) {
  clientparams['region'] = REGION;
}

var s3client = new s3(clientparams);

var params = {
  Bucket: BUCKET
};

var prefix_length = 0;
if (PREFIX) {
  params['Prefix'] = PREFIX;
  prefix_length = PREFIX.split('/').length;
}

var excludes = [];
if (EXCLUDE) {
  excludes = EXCLUDE.split(',');
}

var header_depth = 0;
if (HEADER_DEPTH) {
  header_depth = parseInt(HEADER_DEPTH);
}

function list_bucket(cb, listing) {
  if (!listing) {
    listing = {};
  }

  s3client.listObjectsV2(params, function(err, data) {
    if (err) {
      cb(err, null);
    } else {
      data.Contents.forEach(function(ele) {
        let excludehits = excludes.reduce(function(hits, glob) {
          if (minimatch(ele.Key, glob)) {
            return hits + 1;
          } else {
            return hits;
          }
        }, 0);

        if (excludehits == 0) {
          let parts = ele.Key.split('/').slice(prefix_length);
          let l = listing;
          for (let idx = 0; idx < parts.length - 1; idx++) {
            if (!(parts[idx] in l)) {
              l[parts[idx]] = {};
            }
            l = l[parts[idx]];
          }
          l[parts[parts.length - 1]] = ele;
        }
      });
      if (data.IsTruncated) {
        params['ContinuationToken'] = data.NextContinuationToken;
        list_bucket(cb, listing);
      } else {
        cb(null, listing);
      }
    }
  });
}

function padding(depth) {
  return " ".repeat(depth * 2);
}

function make_url(key) {
  let s3url = "s3://" + BUCKET + "/" + key;
  if (DL_HELPER) {
    return DL_HELPER + "?url=" + encodeURIComponent(s3url);
  } else {
    return s3url;
  }
}

function write_level(fh, listing, depth) {
  Object.keys(listing).sort().forEach(function(key) {
    let ele = listing[key];
    if ('Key' in ele) {
      fh.write(padding(depth - header_depth) + "- [" + key + "](" + make_url(ele['Key']) + ") [" + filesize(ele['Size']) +
          "][" + ele['LastModified'].toUTCString() + "]\n");
    } else if (depth < header_depth) {
      fh.write("#".repeat(depth + 1) + " " + key + "\n");
      write_level(fh, listing[key], depth + 1);
    } else {
      fh.write(padding(depth - header_depth) + "- " + key + "\n");
      write_level(fh, listing[key], depth + 1);
    }
  });
}

function count_artifacts(listing) {
  return Object.keys(listing).reduce(function(count, key) {
    let ele = listing[key];
    if ('Key' in ele) {
      return count + 1;
    } else {
      return count + count_artifacts(listing[key]);
    }
  }, 0);
}

function process_listing(listing) {
  let fh = fs.createWriteStream(OUTPUT_FILE, {
    flags: 'w'
  });

  fh.write("\n---\n\n");
  fh.write("**Bucket:** " + BUCKET + "\n\n");
  fh.write("**Path Prefix:** " + PREFIX + "\n\n");
  fh.write("**Region:** " + REGION + "\n\n");
  fh.write("**Artifact Count:** " + count_artifacts(listing) + "\n\n");
  fh.write("---\n\n");

  write_level(fh, listing, 0);

  fh.close();
}

list_bucket(function(err, listing) {
  if (err) {
    core.error(err);
    core.setFailed(err);
  } else {
    process_listing(listing);
  }
});
