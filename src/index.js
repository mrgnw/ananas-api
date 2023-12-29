import { Ai } from '@cloudflare/ai';

export default {
  async fetch(request, env) {
    const ai = new Ai(env.AI);
    const inputs = {
      text: 'Tell me a joke about Cloudflare',
      source_lang: 'en',
      target_lang: 'fr'
    };
    const response = await ai.run('@cf/meta/m2m100-1.2b', inputs);

    return Response.json({ inputs, response });
  }
};
