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

function isDomainAllowed(url: string): boolean {
    try {
        const hostname = new URL(url).hostname;
        return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
    } catch {
        return false;
    }
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

        if (!isDomainAllowed(url)) {
            return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: `Domain not in allowlist: ${new URL(url).hostname}` }) };
        }

        const fetchOptions: RequestInit = {
            method,
            headers: { 'Content-Type': 'application/json', ...headers }
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
        const statusCode = (error.message || '').startsWith('Unauthorized') ? 401 : 500;
        return {
            statusCode,
            headers: corsHeaders,
            body: JSON.stringify({ error: error.message || 'Proxy error' })
        };
    }
};
