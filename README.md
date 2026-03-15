# RamN AI (Beta)

**RamN AI** is a production-ready, multi-agent orchestrator built with React, Vite, and the Gemini API. It allows users to orchestrate specialized AI agents into dynamic workspaces and provides a customized Spectrum model roster.

> **Status:** Current release is the Beta version, featuring simplified email authentication and direct integration with OpenRouter and HuggingFace API keys.

## Core Features

- **Prism Orchestrator (Meta-Agent):** Prism automatically analyzes your objective and deploys customized, role-playing agents in seconds using **Create Agents** mode.
- **Spectrum Model Roster:** Easily swap between API models utilizing your own OpenRouter and HuggingFace API keys, dynamically managing the AI's compute backing.
- **Local Workspaces:** Configure chatbots, manage groups, and break down complex workflows manually or asynchronously.
- **Memory Data & Knowledge Processing:** Integrated smoothly with Amazon S3. Simply deploy an agent and load relevant "Memory Data" (PDF, TXT, DOCX) directly to the specific Agent.

## Quick Start (Local Development)

### 1. Prerequisites
- Node.js (Current LTS)
- OpenRouter, HuggingFace, or Gemini API keys

### 2. Installation
```bash
npm install
```

### 3. Start the Development Server
```bash
npm run dev
```
The application will be available at `http://localhost:3000`.

### 4. Configuration
Once the app loads, provide any email at the login screen. Then, open your **User Profile** (bottom left corner) and insert your OpenRouter or HuggingFace API Key. This key is used directly for prompt routing.

## Deployment

This repository is optimized to deploy directly out of the box to edge providers like Vercel or Netlify, or AWS Amplify using the integrated YAML definitions. All execution takes place between the client and API providers, persisting metadata into DynamoDB and objects to S3.
