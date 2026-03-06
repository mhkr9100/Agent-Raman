import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const catalogPath = path.join(__dirname, '../toolCatalog.json');
const rawData = fs.readFileSync(catalogPath, 'utf8');
const catalog = JSON.parse(rawData);

const TOOLS_TO_REMOVE = [
    'sendEmail',
    'readCalendar',
    'calendarific',
    'executeCode',
    'slack_webhook',
    'slack-notify',
    'discord_webhook',
    'sendgrid',
    'mailchimp'
];

const filtered = catalog.filter(t => !TOOLS_TO_REMOVE.includes(t.id));

fs.writeFileSync(catalogPath, JSON.stringify(filtered, null, 4));
console.log(`Removed tools from JSON. Remaining tools count: ${filtered.length}`);
