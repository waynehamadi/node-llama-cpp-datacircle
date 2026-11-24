# Datacircle functions for node-llama-cpp

Find the best GTM APIs. We benchmark all the GTM APIs and we put the results on our website.

Our website: https://datacircle.dev

This package gives [node-llama-cpp](https://github.com/withcatai/node-llama-cpp) four functions that call Datacircle's open API, https://api.datacircle.dev/v1. A local model calls them in a `LlamaChatSession`. node-llama-cpp runs them for the model. You need no key and no account.

| Function | What the function gives | Call |
| --- | --- | --- |
| `datacircle_list_apis` | Every GTM API on Datacircle, with the API's slug, number of plans, number of providers and best plan | `GET /apis` |
| `datacircle_best_plans` | One API's plans, sorted by score out of 100, best first. Each plan comes with a rank and a price per 1,000 calls | `GET /apis/{slug}/best` |
| `datacircle_search_plans` | Plans that match a provider or plan name, on all APIs or on one API. You can sort them by score, provider or price | `GET /plans` |
| `datacircle_provider` | The APIs a provider sells, and the provider's rank on each API, best ranks first | `GET /providers/{slug}` |

## Install

```bash
npm install @datacircle/node-llama-cpp node-llama-cpp
```

The functions work with `node-llama-cpp` 3.0.0 and later. We build each one with node-llama-cpp's `defineChatSessionFunction`. Use a model that can call functions, like Qwen3, Llama 3.1 or Functionary.

## Use the functions

Pass `datacircleFunctions()` to `session.prompt()`:

```ts
import { getLlama, LlamaChatSession } from 'node-llama-cpp';
import { datacircleFunctions } from '@datacircle/node-llama-cpp';

const llama = await getLlama();
const model = await llama.loadModel({ modelPath: 'models/Qwen3-8B-Q4_K_M.gguf' });
const context = await model.createContext();
const session = new LlamaChatSession({ contextSequence: context.getSequence() });

const answer = await session.prompt('Who are the 3 best providers for the email-finder API?', {
  functions: datacircleFunctions(),
});
console.log(answer);
```

You can put `datacircleFunctions()` beside your own functions in one object: `{ ...datacircleFunctions(), myFunction }`. To give the model every Datacircle function except `datacircle_provider`, write `const { datacircle_provider, ...functions } = datacircleFunctions()`.

## Make each call yourself

You can make each call without a model. You get back an object, and the model reads that object as JSON:

```ts
import { bestPlans } from '@datacircle/node-llama-cpp';

const answer = await bestPlans({ slug: 'email-finder', limit: 3 });
console.log(answer.plans);
```

The other calls are `listApis()`, `searchPlans()` and `providerRanks()`. A function's `handler` returns the same object as calling the function yourself.

## What the model reads

Each function gives the model a JSON object. Each plan comes with a rank, provider, plan, score, price per 1,000 (`perThousand`, in dollars) and a page on datacircle.dev. That page lists every field.

node-llama-cpp makes the model write every parameter. For an unneeded parameter, the model writes `null` and the function uses the parameter's default. The model must pick a sort. Sort by `score` to get the best plans first.

With a `null` limit, each function gives 10 items. Ten items fit in a small context. The model can ask for more with `limit`.

The model reads `{"error": ...}` with the API's message when the API gives no data, for example for an unknown slug. If the network fails, the model also reads `{"error": ...}`, with the network error's message. The model can call again without stopping your prompt.

To set the `fetch` the functions use, pass `datacircleFunctions({ fetch })`. Your `fetch` can add a proxy or a timeout. To call a function without a model, pass `{ fetch }` as the second argument.

## Network

Each function call makes one HTTPS GET request to https://api.datacircle.dev/v1 and nothing else. When a slug needs a second try, the call makes two. The request holds only the function's parameters: no key and nothing from your chats. The API takes up to 60 calls a minute from one IP address. The function waits once, for a minute at most, if the API asks for a pause. The package has no dependencies besides node-llama-cpp and stores nothing.

## Links

- Datacircle: https://datacircle.dev
- The API: https://datacircle.dev/api
- The API's spec: https://api.datacircle.dev/v1/openapi.json
- What each key means: https://datacircle.dev/fields

MIT license.
