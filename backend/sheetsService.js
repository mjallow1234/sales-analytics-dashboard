// Google Sheets service wrapper

const { google } = require('googleapis');
const path = require('path');

// configure auth using service account credentials
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'google-credentials.json'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets('v4');

async function getSalesData() {
  const client = await auth.getClient();
  const response = await sheets.spreadsheets.values.get({
    auth: client,
    spreadsheetId: '1soZRvVb2qGZDgkm5NHxukOnufGLVAmIAisOQSaknlwE',
    range: 'Sales Updated!A:L',
  });
  // return raw rows (might be undefined if no data)
  return response.data.values || [];
}

module.exports = { getSalesData };
