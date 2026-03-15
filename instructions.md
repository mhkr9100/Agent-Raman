"CRITICAL RULES:                                            │
│   1. DO NOT simulate, mock, or hardcode any AI response.    │
│   2. DO NOT use setTimeout, fake loaders, or fake progress. │
│   3. DO NOT return demo, sample, seeded, or placeholder UI  │
│      data in active runtime paths.                          │
│   4. ALL authoritative product data must come from real     │
│      backend APIs backed by DynamoDB or configured storage. │
│   5. ALL AI responses must come from real live model calls. │
│      Current production default is Vertex AI.               │
│   6. If a database table or query is empty, return [] or    │
│      null truthfully. Never resurrect deleted local state.  │
│   7. If an API call fails, return the real error message    │
│      and real HTTP status semantics.                        │
│   8. DO NOT put orchestration, routing, quota, or business  │
│      decision logic in frontend code. Frontend only renders │
│      state and transports user input.                       │
│   9. DO NOT create hidden fallback features, legacy modes,  │
│      or parallel codepaths without explicit approval.       │
│  10. ONLY expose currently supported live capabilities in   │
│      the UI. If a capability is not live, it must not be    │
│      selectable. Current user-facing capabilities:          │
│      web-search and thinking.                               │
│  11. ChatBot creation must be Prism-driven from user intent │
│      and saved through real backend persistence. Spectrum   │
│      is display-first; only Group creation may originate    │
│      there.                                                 │
│  12. UserMap, conversations, groups, chatbots, and documents │
│      must be server-authoritative and consistent across     │
│      refresh, logout, and cross-browser sessions.           │
│  13. Document understanding must happen server-side through │
│      real parsing/retrieval. Never inject raw document text │
│      blindly into every user message.                       │
│  14. Streaming must be real streamed model output, not      │
│      simulated chunking.                                    │
│  15. UserMap parsing must produce human-quality nodes.      │
│      Never store section headers, truncated labels, or      │
│      duplicated label/value pairs as final memory nodes.    │
│  16. Preserve semantic hierarchy when extracting context.   │
│      Related facts like degree + institution must be nested │
│      coherently, not flattened arbitrarily.                 │
│  17. No temporary patching. Fix root causes structurally,   │
│      remove dead code, and keep one canonical codepath.     │
│  18. Test each changed workflow with real backend data      │
│      before considering the task complete."                 │
