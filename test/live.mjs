// Each function's own handler on the live API, as LlamaChatSession calls it: with the params node-llama-cpp's grammar makes
// the model write (every key, null where it leaves one out), whose answer the session gives the model as JSON; the answers
// a model's mistakes get; and what an app's own code may pass a handler. npm test
import { bestPlans, datacircleFunctions, listApis, providerRanks, searchPlans } from '@datacircle/node-llama-cpp';

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed++;
};
// The session awaits the handler and gives its answer to the model as JSON: a throw would end the whole prompt.
const run = async (f, params) => {
  try {
    return JSON.parse(JSON.stringify(await f.handler(params)));
  } catch (error) {
    return { threw: error.message };
  }
};

const functions = datacircleFunctions();
const NAMES = 'datacircle_list_apis,datacircle_best_plans,datacircle_search_plans,datacircle_provider';
check('names', Object.keys(functions).join(',') === NAMES, Object.keys(functions).join(','));
// What the session sends the model of each: its description and params, an object schema whose every key is a value or null.
for (const [name, f] of Object.entries(functions)) {
  const s = f.params;
  check(`${name} definition`, s.type === 'object' && Object.keys(s.properties).length > 0 && typeof f.handler === 'function'
    && f.description.length > 50 && Object.values(s.properties).every((p) => typeof p.description === 'string'),
    `params [${Object.keys(s.properties)}]`);
}
const { datacircle_list_apis: list, datacircle_best_plans: best, datacircle_search_plans: search, datacircle_provider: provider } = functions;

let r = await run(list, { query: null, limit: null });
check('list_apis', r.total > 100 && r.apis.length === 10 && r.apis[0].slug && !r.note, `total ${r.total}, first ${r.apis[0]?.slug}`);
r = await run(list, { query: 'email', limit: 3 });
check('list_apis email', r.apis?.length === 3 && r.apis.every((a) => /email/i.test(a.api + a.slug)) && !r.note, r.apis?.map((a) => a.slug).join(', '));
r = await run(list, { query: 'Bright Data', limit: null });
check('list_apis provider name', typeof r.note === 'string' && r.note.includes('datacircle_search_plans'), r.note);
r = await run(list, { query: '', limit: 500 });
check('list_apis limit 500: 200 at most', r.apis?.length === Math.min(200, r.total), `${r.apis?.length} of ${r.total}`);

r = await run(best, { slug: 'email-finder', limit: 3 });
check('best_plans', r.plans.length === 3 && r.plans[0].rank === 1 && typeof r.plans[0].score === 'number' && r.plans[0].page && !('aggregators' in r.plans[0]),
  `${r.api}: ${r.plans.map((p) => `${p.rank}. ${p.provider} ${p.score}`).join(' / ')}`);
r = await run(best, { slug: 'Email Finder', limit: 99 });
check('best_plans name, limit 99', r.plans?.length >= 10 && r.slug === 'email-finder', `${r.plans?.length} plans`);
r = await run(best, { slug: 'email-finder', limit: null });
check('best_plans limit null', r.plans?.length === 10, `${r.plans?.length} plans`);
r = await run(best, { slug: 'email-finder', limit: -4 });
check('best_plans limit -4: the default', r.plans?.length === 10, `${r.plans?.length} plans`);
r = await run(best, { slug: 'bright-data', limit: null });
check('best_plans unknown slug', r.error?.startsWith('no API has the slug bright-data') && r.error.includes('datacircle_search_plans'), r.error);
r = await run(best, { slug: 'serp-api', limit: 2 });
check('best_plans slug with -api', r.slug === 'serp' && r.plans?.length === 2 && r.note?.startsWith('No API has the slug serp-api'), r.note);
r = await run(best, { slug: 'Email Finder API Pricing', limit: 1 });
check('best_plans name with API pricing', r.slug === 'email-finder' && r.plans?.length === 1, r.note);
r = await run(best, { slug: '<api-slug-here>', limit: null });
check('best_plans placeholder', r.error?.startsWith('"<api-slug-here>" is a placeholder'), r.error);
r = await run(best, { slug: 'nope-api', limit: null });
check('best_plans unknown slug with -api', r.error?.startsWith('no API has the slug nope-api.'), r.error);
r = await run(best, { slug: '', limit: null });
check('best_plans empty slug', r.error?.startsWith("Give an API's slug"), r.error);

r = await run(search, { api: null, query: 'bright data', sort: 'price', limit: 5, offset: null });
check('search_plans', r.total > 0 && r.plans.length === 5 && r.plans.every((p) => /bright data/i.test(p.provider)), `total ${r.total}, cheapest ${r.plans[0]?.perThousand}`);
r = await run(search, { api: 'email-finder', query: null, sort: 'score', limit: 2, offset: 1 });
check('search_plans api offset', r.plans.length === 2 && r.plans[0].rank === 2, r.plans.map((p) => `${p.rank}. ${p.provider}`).join(' / '));
r = await run(search, { api: 'Bright Data', query: null, sort: 'score', limit: null, offset: null });
check('search_plans provider as api', r.total > 0 && r.note?.startsWith('No API is named'), `total ${r.total}: ${r.note}`);
r = await run(search, { api: 'Bright Data', query: 'cheapest', sort: 'price', limit: 3, offset: 0 });
check('search_plans provider as api, a word no name holds', r.plans?.length === 3 && r.plans.every((p) => /bright data/i.test(p.provider))
  && r.note?.startsWith('No API is named "Bright Data"') && r.note.includes('"cheapest" was left out'), `total ${r.total}: ${r.note}`);
r = await run(search, { api: 'Emelia', query: 'credits', sort: 'score', limit: 3, offset: null });
check('search_plans provider as api, with words a name holds', r.total > 0 && r.plans.every((p) => /emelia/i.test(p.provider) && /credits/i.test(p.plan))
  && r.note === 'No API is named "Emelia": these are the plans whose provider or plan name holds "Emelia credits".', `total ${r.total}: ${r.note}`);
r = await run(search, { api: null, query: 'bright-data', sort: 'score', limit: null, offset: null });
check('search_plans slug as query', r.total > 0 && r.note?.includes('"bright data"'), `total ${r.total}: ${r.note}`);
r = await run(search, { api: null, query: null, sort: 'provider', limit: 0, offset: -3 });
check('search_plans out of range: the defaults', r.plans?.length === 10, `${r.plans?.length} plans`);
r = await run(search, { api: null, query: 'emelia', sort: 'score', limit: null, offset: null });
check('search_plans emelia', r.total > 0 && r.plans.every((p) => /emelia/i.test(p.provider + p.plan)), `total ${r.total}`);

r = await run(provider, { slug: 'Bright Data', limit: null });
check('provider', r.slug === 'bright-data' && r.total > 10 && r.apis.length === 10 && r.ranked > 0 && r.apis[0].rank <= r.apis[1].rank && r.apis[0].best?.plan
  && r.note === `Its 10 best ranks of the ${r.total} APIs it sells. limit gives more, up to 200.`,
  `${r.provider}: ${r.total} APIs, ranked on ${r.ranked}, best ${r.apis[0].api} #${r.apis[0].rank}, ${JSON.stringify(r).length} chars`);
r = await run(provider, { slug: 'bright-data', limit: 500 });
check('provider limit 500: every API', r.apis?.length === r.total && !r.note && r.apis.at(-1).rank === undefined, `${r.apis?.length} of ${r.total}, ${JSON.stringify(r).length} chars`);
r = await run(provider, { slug: '<provider-slug>' });
check('provider placeholder', r.error?.startsWith('"<provider-slug>" is a placeholder'), r.error);
r = await run(provider, { slug: 'nobody-x' });
check('provider unknown', r.error?.startsWith('no provider has the slug nobody-x'), r.error);
r = await run(provider, { slug: 'email-finder' });
check("provider: an API's slug", r.error?.startsWith('no provider has the slug email-finder') && r.error.includes('datacircle_best_plans'), r.error);

// A handler called by an app's own code: keys left out, a number as text, a wrong type: its answer, never a throw.
r = await run(list, undefined);
check('list_apis no params at all', r.apis?.length === 10, `${r.apis?.length} APIs`);
r = await run(best, { slug: 'serp', limit: '1' });
check('best_plans limit as text', r.plans?.length === 1, `${r.plans?.length} plan`);
r = await run(best, { limit: 2 });
check('best_plans no slug: {error}', r.error === 'slug is needed', r.error ?? r.threw);
r = await run(best, { slug: 'serp', limit: 'many' });
check('best_plans limit not a number: {error}', r.error === 'limit must be a number', r.error ?? r.threw);
r = await run(search, { sort: 'cheapest' });
check('search_plans bad sort: {error}', r.error === 'sort must be score, provider or price', r.error ?? r.threw);
r = await run(provider, { slug: 42 });
check('provider slug not text: {error}', r.error === 'slug must be text', r.error ?? r.threw);

// The same calls without a model.
for (const [name, call] of [['listApis', () => listApis({ limit: 1 })], ['bestPlans', () => bestPlans({ slug: 'serp', limit: 1 })],
  ['searchPlans', () => searchPlans({ limit: 1 })], ['providerRanks', () => providerRanks({ slug: 'bright-data' })]]) {
  r = await call();
  check(name, !r.error && (r.apis ?? r.plans)?.length > 0, Object.keys(r).join(','));
}
r = await bestPlans({ slug: 'nope-api' });
check('bestPlans unknown: {error}', r.error?.startsWith('no API has the slug nope-api'), r.error);

// Each call's User-Agent, through a fetch of the app's own.
const seen = [];
const traced = datacircleFunctions({ fetch: (url, init) => (seen.push([String(url), init.headers['User-Agent']]), fetch(url, init)) });
await run(traced.datacircle_best_plans, { slug: 'serp', limit: 1 });
check('fetch option', seen.length === 1 && seen[0][0] === 'https://api.datacircle.dev/v1/apis/serp/best?limit=1' && seen[0][1] === 'datacircle-node-llama-cpp/0.1.0', seen.flat().join(' '));

// A network that fails is the model's to read as {error}, never a throw, so the prompt goes on.
const down = datacircleFunctions({ baseURL: 'http://127.0.0.1:9' });
r = await run(down.datacircle_best_plans, { slug: 'serp', limit: null });
check('network down', r.error?.startsWith('datacircle:'), r.error ?? r.threw);

console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
