import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET, S3_ENDPOINT } = process.env;

export const configured = Boolean(S3_BUCKET && S3_REGION && S3_ACCESS_KEY && S3_SECRET);

const client = configured
  ? new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT || undefined,
      credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET },
      forcePathStyle: true, // required by R2 and most non-AWS S3-compatible providers
    })
  : null;

// Generates a short-lived URL that lets the browser download the object
// directly from R2 — the file goes straight to the user's device, it
// never passes through our server. response-content-disposition forces a
// real "Save As" download instead of the browser trying to play/preview it.
export async function getDownloadUrl(key, downloadFilename) {
  if (!client) throw new Error('Recording storage is not configured');
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${downloadFilename}"`,
  });
  return getSignedUrl(client, command, { expiresIn: 300 }); // 5 minutes
}
