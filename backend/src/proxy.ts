import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { buildCorsHeaders, requireAuth } from './security.js';

/**
 * CORS Proxy Lambda
 * Forwards API requests to external services that don't support browser CORS.
 * Whitelist of allowed domains for security.
 */

const ALLOWED_DOMAINS = [
    'api.coingecko.com',
    'newsapi.org',
    'api.currentsapi.services',
    'hacker-news.firebaseio.com',
    'api.exchangerate-api.com',
    'api.quotable.io',
    'api.github.com',
    'api.openweathermap.org',
    'api.unsplash.com',
    'api.pexels.com',
    'api.deepl.com',
    'slack.com',
    'discord.com',
    'api.sendgrid.com',
    'api.mailchimp.com',
    'api.notion.com',
    'api.trello.com',
    'api.calendarific.com',
    'api.uptimerobot.com',
    'api.producthunt.com',
    'api.hunter.io',
    'api.clearbit.com',
    'api.countapi.xyz',
    'api.ipify.org',
    'ipapi.co',
    'restcountries.com',
    'api.genderize.io',
    'api.agify.io',
    'api.nationalize.io',
    'randomuser.me',
    'jsonplaceholder.typicode.com',
    'httpbin.org',
    'api.adviceslip.com',
    'uselessfacts.jsph.pl',
    'api.spacexdata.com',
    'pokeapi.co',
    'swapi.dev',
    'gnews.io',
    'serpapi.com',
    'api.marketaux.com',
    'finnhub.io',
    'www.alphavantage.co'
];

const FORBIDDEN_HEADERS = [
    'host', 'cookie', 'authorization', 'x-forwarded-for', 'x-real-ip',
    'set-cookie', 'proxy-authorization', 'x-forwarded-host', 'x-original-url',
    'x-rewrite-url', 'forwarded', 'origin'
];

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const safe: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (!FORBIDDEN_HEADERS.includes(key.toLowerCase())) {
            safe[key] = value;
        }
    }
    return safe;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    const corsHeaders = {
        ...buildCorsHeaders(event.headers, 'OPTIONS,POST'),
        'Content-Type': 'application/json'
    };
    const method = (event.requestContext as any)?.http?.method || (event as any).httpMethod || 'GET';

    if (method === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        await requireAuth(event.headers);

        const body = JSON.parse(event.body || '{}');
        const { url, method = 'GET', headers = {}, payload } = body;

        if (!url) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'URL is required' }) };
        }

        // Parse once; reuse for both domain check and credential check
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid URL' }) };
        }

        const hostname = parsedUrl.hostname;
        if (!ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
            return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: `Domain not in allowlist: ${hostname}` }) };
        }

        // Block URLs with embedded credentials (SSRF bypass vector)
        if (parsedUrl.username || parsedUrl.password) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'URL credentials are not allowed' }) };
        }

        const fetchOptions: RequestInit = {
            method,
            headers: { 'Content-Type': 'application/json', ...sanitizeHeaders(headers) }
        };
        if (payload && method !== 'GET') {
            fetchOptions.body = typeof payload === 'string' ? payload : JSON.stringify(payload);
        }

        const response = await fetch(url, fetchOptions);
        const responseText = await response.text();

        // Try to parse as JSON, fallback to text
        let responseBody: any;
        try {
            responseBody = JSON.parse(responseText);
        } catch {
            responseBody = { text: responseText };
        }

        return {
            statusCode: response.status,
            headers: corsHeaders,
            body: JSON.stringify({
                status: response.status,
                data: responseBody
            })
        };

    } catch (error: any) {
        const isAuthError = (error.message || '').startsWith('Unauthorized');
        return {
            statusCode: isAuthError ? 401 : 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: isAuthError ? 'Unauthorized' : 'Proxy request failed' })
        };
    }
};
