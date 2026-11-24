// node-llama-cpp functions on Datacircle's open API: find the best GTM APIs. The API needs no key:
// https://api.datacircle.dev/v1 (its spec: https://api.datacircle.dev/v1/openapi.json). More at https://datacircle.dev

import { defineChatSessionFunction } from 'node-llama-cpp';
import { ApiError, BASE_URL, Client, VERSION, brief, briefPlans, clamp, objects, slugify } from './client.js';
import type { Answer, DatacircleOptions } from './client.js';

export { ApiError, BASE_URL, VERSION };
export type { Answer, DatacircleOptions };

const LIST_APIS_ABOUT = "Lists the GTM APIs on Datacircle's sheet (https://datacircle.dev). GTM means go-to-market. GTM APIs are the APIs sales and marketing teams use. Gives each API's slug, how many plans and providers it has and its best plan. Call it first to find an API's slug.";
const BEST_PLANS_ABOUT = "Gives the best providers for one API, like email-finder: the API's plans best first by their score out of 100 on Datacircle's benchmark (https://datacircle.dev), each with its rank, provider, plan, $ per 1,000 calls and its page. perThousand is a plan's price of 1,000 items in dollars, pay the plan's whole price in its currency.";
const SEARCH_PLANS_ABOUT = "Searches every plan on Datacircle's sheet (https://datacircle.dev), or one API's, by provider or plan name, sorted by score, provider or price. Gives how many were found and up to limit of them. perThousand is a plan's price of 1,000 items in dollars, pay the plan's whole price in its currency.";
const PROVIDER_ABOUT = "Gives where one provider, like Bright Data, ranks: each API the provider sells and its rank on each on Datacircle's benchmark (https://datacircle.dev), with its best plan there, its best rank first. total is how many APIs it sells, ranked on how many of them it has a rank. For an API's best providers, call datacircle_best_plans.";

// Tells a model that sent a provider's name to an API's function where a provider's plans are.
const FOR_PROVIDER = "A provider's plans: datacircle_search_plans with its name as query, like bright data, or datacircle_provider.";

// Tells a model that sent an API's slug to the provider's function where an API's best providers are.
const FOR_API = "An API's best providers: datacircle_best_plans with the API's slug, like email-finder.";

// Each function's params, as node-llama-cpp's grammar makes the model write them: every key, in this order. A key the API
// can leave out is null or a value (node-llama-cpp's advice for optional values), and its description says what null gives.
const orNull = <const T extends object>(schema: T, description: string) => ({ oneOf: [{ type: 'null' }, schema], description }) as const;

const listApisParams = {
  type: 'object',
  properties: {
    query: orNull({ type: 'string' }, "Words of the API's name or slug, like email or linkedin profile: the APIs that hold the most of them come first. null for the sheet's order"),
    limit: orNull({ type: 'integer' }, 'How many APIs to give, 1 to 200. null for 10: the sheet has about 170'),
  },
} as const;

const bestPlansParams = {
  type: 'object',
  properties: {
    slug: { type: 'string', description: "The API's slug, like email-finder or linkedin-profile, as datacircle_list_apis gives it" },
    limit: orNull({ type: 'integer' }, 'How many plans to give, 1 to 50. null for 10'),
  },
} as const;

const searchPlansParams = {
  type: 'object',
  properties: {
    api: orNull({ type: 'string' }, "Only this API's plans: its name or slug, like email-finder. A provider's name goes in query, never here. null for every API"),
    query: orNull({ type: 'string' }, "Words that must all appear in the provider's or plan's name, like bright data. null for every plan"),
    sort: { enum: ['score', 'provider', 'price'], description: 'score (best first, as the sheet orders them), provider (A to Z) or price ($ per 1,000, lowest first)' },
    limit: orNull({ type: 'integer' }, 'How many plans to give, 1 to 50. null for 10'),
    offset: orNull({ type: 'integer' }, 'How many found plans to skip first. null for 0'),
  },
} as const;

const providerParams = {
  type: 'object',
  properties: {
    slug: { type: 'string', description: "The provider's slug, like bright-data, or its name, like Bright Data: the name is made a slug" },
    limit: orNull({ type: 'integer' }, 'How many of its APIs to give, its best ranks first, 1 to 200. null for 10'),
  },
} as const;

/** datacircle_list_apis' params. */
export type ListApisInput = { query?: string | null; limit?: number | null };
/** datacircle_best_plans' params. */
export type BestPlansInput = { slug: string; limit?: number | null };
/** datacircle_search_plans' params. */
export type SearchPlansInput = { api?: string | null; query?: string | null; sort?: 'score' | 'provider' | 'price' | null; limit?: number | null; offset?: number | null };
/** datacircle_provider's params. */
export type ProviderInput = { slug: string; limit?: number | null };

// The model's params fit the grammar. A handler called by an app's own code may get anything: a number as text is read as
// one, a fraction cut to its whole part, a limit or an offset out of range takes its default, a wrong type is its answer.
const SORTS = ['score', 'provider', 'price'];

function asText(params: Answer, key: string, needed = false): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    if (needed) throw new TypeError(`${key} is needed`);
    return undefined;
  }
  if (typeof value !== 'string') throw new TypeError(`${key} must be text`);
  return value;
}

function asCount(params: Answer, key: string): number | undefined {
  const value = params[key];
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new TypeError(`${key} must be a number`);
  return Math.trunc(n);
}

function asSort(params: Answer): SearchPlansInput['sort'] {
  const value = asText(params, 'sort');
  if (value === undefined) return undefined;
  if (!SORTS.includes(value)) throw new TypeError('sort must be score, provider or price');
  return value as SearchPlansInput['sort'];
}

/** A limit within the API's bounds, or undefined for the API's default. */
const bounded = (n: number | null | undefined, high: number) => (n === undefined || n === null || !(n >= 1) ? undefined : clamp(n, 1, high));

/** An answer of 4xx (an unknown slug, a wrong argument) is the call's answer as {error}, the API's words. */
function asResult(error: unknown): Answer {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

async function listApisRun(client: Client, { query, limit }: ListApisInput): Promise<Answer> {
  let apis: Answer[];
  try {
    apis = objects(await client.get<unknown>('/apis'));
  } catch (error) {
    return asResult(error);
  }
  const words = (query ?? '').toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  const found = apis
    .map((api, order) => {
      const name = `${String(api.api ?? '')} ${String(api.slug ?? '').replace(/-/g, ' ')}`.toLowerCase();
      return { order, matched: words.filter((word) => name.includes(word)).length, api };
    })
    .filter(({ matched }) => matched > 0 || words.length === 0)
    // The most words matched first, the sheet's order within each.
    .sort((a, b) => b.matched - a.matched || a.order - b.order);
  const answer: Answer = {
    total: found.length,
    apis: found.slice(0, bounded(limit, 200) ?? 10)
      .map(({ api }) => brief(api, ['api', 'slug', 'plans', 'providers', 'best', 'bestPage', 'sheetPage'])),
  };
  if (words.length > 0 && (found.length === 0 || found[0].matched < words.length)) {
    // A provider's name sent as an API's, like Bright Data, whose data matches many APIs: where its plans are.
    answer.note = `No API's name holds every word of ${JSON.stringify(query)}. A provider's plans: datacircle_search_plans with its name as query, or datacircle_provider.`;
  }
  return answer;
}

/** A placeholder a small model copies from a prompt's example, like <api-slug>, sent in place of a slug. */
const PLACEHOLDER = /[<>{}]/;

async function bestPlansRun(client: Client, { slug, limit }: BestPlansInput): Promise<Answer> {
  if (PLACEHOLDER.test(slug ?? '')) {
    return { error: `${JSON.stringify(slug)} is a placeholder. Give the API's own slug, like email-finder: datacircle_list_apis gives every slug.` };
  }
  const api = slugify(slug ?? '');
  if (api === '') return { error: `Give an API's slug, like email-finder: datacircle_list_apis gives every slug. ${FOR_PROVIDER}` };
  const best = async (api: string) => {
    const answer = await client.get(`/apis/${api}/best`, { limit: bounded(limit, 50) });
    return { ...answer, plans: briefPlans(answer.plans) };
  };
  try {
    return await best(api);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // The slug with "api" after it, like serp-api, as the sheet's address reads (/serp-api-pricing): the API's own.
      const bare = api.replace(/-api(-pricing)?$/, '');
      if (bare !== api && bare !== '') {
        try {
          return { ...(await best(bare)), note: `No API has the slug ${api}: these are ${bare}'s plans.` };
        } catch {
          // The first answer stands.
        }
      }
      // A provider's name sent as the API's slug: the API's words, and where a provider's plans are.
      return { error: `${error.message}. datacircle_list_apis gives every API's slug. ${FOR_PROVIDER}` };
    }
    return asResult(error);
  }
}

async function searchPlansRun(client: Client, input: SearchPlansInput): Promise<Answer> {
  const search = (api: string, query: string) =>
    client.get('/plans', {
      api: api.trim(),
      query: query.trim(),
      sort: input.sort ?? undefined,
      limit: bounded(input.limit, 50),
      offset: input.offset === undefined || input.offset === null || !(input.offset > 0) ? undefined : Math.trunc(input.offset),
    });
  let api = input.api ?? '';
  let query = input.query ?? '';
  const notes: string[] = [];
  try {
    let answer: Answer;
    try {
      answer = await search(api, query);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 400 && error.message.includes('api must be'))) throw error;
      // A provider's name sent as the API: the plans whose provider or plan name holds it, with the query's words when a
      // name holds them too. A word no name holds, like cheapest, is left out.
      const name = api;
      const both = query.trim() === '' ? undefined : await search('', `${name} ${query}`);
      api = '';
      if (both !== undefined && both.total !== 0) {
        query = `${name} ${query}`;
        answer = both;
      } else {
        answer = await search('', name);
        if (query.trim() !== '') notes.push(`No name holds ${JSON.stringify(name)} with ${JSON.stringify(query)}, so ${JSON.stringify(query)} was left out.`);
        query = name;
      }
      notes.unshift(`No API is named ${JSON.stringify(input.api)}: these are the plans whose provider or plan name holds ${JSON.stringify(query)}.`);
    }
    if (answer.total === 0 && query.includes('-')) {
      // A slug sent as a name, like bright-data, which no name holds: its words, like bright data. A name with a
      // hyphen, like A-Leads, is found as it is first.
      const words = query.replace(/-/g, ' ').split(/\s+/).filter(Boolean).join(' ');
      try {
        answer = await search(api, words);
        notes.push(`No provider's or plan's name holds ${JSON.stringify(query)}: these are the plans whose name holds ${JSON.stringify(words)}.`);
      } catch {
        // The first answer stands.
      }
    }
    return { ...answer, plans: briefPlans(answer.plans), ...(notes.length > 0 ? { note: notes.join(' ') } : {}) };
  } catch (error) {
    return asResult(error);
  }
}

async function providerRun(client: Client, { slug, limit }: ProviderInput): Promise<Answer> {
  if (PLACEHOLDER.test(slug ?? '')) {
    return { error: `${JSON.stringify(slug)} is a placeholder. Give the provider's own slug or name, like bright-data or Bright Data.` };
  }
  const provider = slugify(slug ?? '');
  if (provider === '') return { error: "Give a provider's slug or name, like bright-data or Bright Data" };
  let answer: Answer;
  try {
    answer = await client.get(`/providers/${provider}`);
  } catch (error) {
    // An API's slug sent as a provider's, like email-finder: the API's words, and where an API's best providers are.
    if (error instanceof ApiError && error.status === 404) return { error: `${error.message}. ${FOR_API}` };
    return asResult(error);
  }
  const apis = objects(answer.apis).map((entry) => {
    const plans = objects(entry.plans);
    const kept: Answer = { ...brief(entry, ['api', 'slug', 'rank', 'bestPage']), plans: plans.length };
    const best = bestPlan(plans);
    if (best) kept.best = brief(best, ['plan', 'score', 'perThousand', 'page']);
    return kept;
  });
  // Its best rank first, the APIs where it has none last, in the API's order.
  const rank = (api: Answer) => (typeof api.rank === 'number' ? api.rank : Infinity);
  apis.sort((a, b) => rank(a) - rank(b));
  // A provider that sells many APIs, like Bright Data's 60 or more, would fill a local model's context: its best ranks.
  const shown = apis.slice(0, bounded(limit, 200) ?? 10);
  const result: Answer = { ...answer, apis: shown, total: apis.length, ranked: apis.filter((api) => typeof api.rank === 'number').length };
  if (shown.length < apis.length) result.note = `Its ${shown.length} best ranks of the ${apis.length} APIs it sells. limit gives more, up to 200.`;
  return result;
}

/** A provider's best plan on an API: its lowest rank, the first when none has a rank. */
function bestPlan(plans: Answer[]): Answer | undefined {
  const ranked = plans.filter((plan) => typeof plan.rank === 'number');
  if (ranked.length === 0) return plans[0];
  return ranked.reduce((best, plan) => ((plan.rank as number) < (best.rank as number) ? plan : best));
}

/**
 * A handler's run: params read, then the API called. What goes wrong is the model's to read as {error} (a wrong param, an
 * answer of 4xx, a failed network), never a throw, as a function that throws ends the whole prompt.
 */
function handler<In>(client: Client, read: (params: Answer) => In, call: (client: Client, input: In) => Promise<Answer>) {
  return async (params: unknown): Promise<Answer> => {
    try {
      return await call(client, read(typeof params === 'object' && params !== null ? (params as Answer) : {}));
    } catch (error) {
      return { error: (error as Error).message };
    }
  };
}

/**
 * The four functions, for session.prompt(text, {functions: datacircleFunctions()}) on a LlamaChatSession, beside an app's
 * own: {...datacircleFunctions(), myFunction}. Each is made by node-llama-cpp's defineChatSessionFunction, its key the name
 * the model calls: datacircle_list_apis (GET /apis), datacircle_best_plans (GET /apis/{slug}/best), datacircle_search_plans
 * (GET /plans) and datacircle_provider (GET /providers/{slug}).
 */
export function datacircleFunctions(options?: DatacircleOptions) {
  const client = new Client(options);
  return {
    datacircle_list_apis: defineChatSessionFunction({
      description: LIST_APIS_ABOUT,
      params: listApisParams,
      handler: handler(client, (p): ListApisInput => ({ query: asText(p, 'query'), limit: asCount(p, 'limit') }), listApisRun),
    }),
    datacircle_best_plans: defineChatSessionFunction({
      description: BEST_PLANS_ABOUT,
      params: bestPlansParams,
      handler: handler(client, (p): BestPlansInput => ({ slug: asText(p, 'slug', true)!, limit: asCount(p, 'limit') }), bestPlansRun),
    }),
    datacircle_search_plans: defineChatSessionFunction({
      description: SEARCH_PLANS_ABOUT,
      params: searchPlansParams,
      handler: handler(client, (p): SearchPlansInput => ({
        api: asText(p, 'api'),
        query: asText(p, 'query'),
        sort: asSort(p),
        limit: asCount(p, 'limit'),
        offset: asCount(p, 'offset'),
      }), searchPlansRun),
    }),
    datacircle_provider: defineChatSessionFunction({
      description: PROVIDER_ABOUT,
      params: providerParams,
      handler: handler(client, (p): ProviderInput => ({ slug: asText(p, 'slug', true)!, limit: asCount(p, 'limit') }), providerRun),
    }),
  };
}

/** The four functions' names, in their order. Their answers name each other by these names. */
export type FunctionName = keyof ReturnType<typeof datacircleFunctions>;

// The same calls without a model: each gives the answer the model would read, as an object, an answer of 4xx as {error}.

/** GET /apis: the APIs, as datacircle_list_apis gives them. */
export const listApis = (input: ListApisInput = {}, options?: DatacircleOptions) => listApisRun(new Client(options), input);

/** GET /apis/{slug}/best: an API's plans best first, as datacircle_best_plans gives them. */
export const bestPlans = (input: BestPlansInput, options?: DatacircleOptions) => bestPlansRun(new Client(options), input);

/** GET /plans: the plans found, as datacircle_search_plans gives them. */
export const searchPlans = (input: SearchPlansInput = {}, options?: DatacircleOptions) => searchPlansRun(new Client(options), input);

/** GET /providers/{slug}: where a provider ranks, as datacircle_provider gives it. */
export const providerRanks = (input: ProviderInput, options?: DatacircleOptions) => providerRun(new Client(options), input);
