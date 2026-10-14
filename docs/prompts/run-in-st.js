// Paste into the browser console on a SillyTavern page (or run via a dev tool), then:
//   await onlyTavernGenerateCorpus('<connection profile name>')
// Sends the prompts in corpus.md through that connection profile and saves each raw
// answer as user/files/onlytavern-gen-*.txt. app/scripts/build-corpus.mjs parses them.
// The model call and text extraction follow EchoText's connection_utils.js. The model
// reasons before answering, so maxTokens must leave room for that.

async function onlyTavernGenerateCorpus(profileName, { folder = 'SillyTavern-CreatorSim', maxTokens = 12000 } = {}) {
    const ctx = SillyTavern.getContext();
    const profile = ctx.extensionSettings.connectionManager.profiles.find((p) => p.name === profileName);
    if (!profile) throw new Error(`Connection profile not found: ${profileName}`);

    const md = await (await fetch(`/scripts/extensions/third-party/${folder}/docs/prompts/corpus.md`, { cache: 'no-cache' })).text();
    const section = (title) => md.split(/^## /m).find((s) => s.startsWith(title)).split('\n').slice(1).join('\n').trim();
    const system = section('System');
    const commentsPrompt = section('Comments');
    const [commentsBody, fanTypes] = commentsPrompt.split('\nFan types:\n');
    const segments = Object.fromEntries(fanTypes.trim().split('\n').map((l) => l.replace(/^- /, '').split(/: (.*)/s).slice(0, 2)));

    function extractText(resp) {
        if (!resp) return null;
        if (typeof resp === 'string') return resp;
        if (typeof resp.content === 'string') return resp.content;
        if (Array.isArray(resp.content)) return resp.content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
        const c = resp.choices?.[0]?.message?.content;
        if (typeof c === 'string') return c;
        if (typeof resp.text === 'string') return resp.text;
        if (typeof resp.message?.content === 'string') return resp.message.content;
        return null;
    }

    async function ask(prompt) {
        const resp = await ctx.ConnectionManagerRequestService.sendRequest(
            profile.id,
            [{ role: 'system', content: system }, { role: 'user', content: prompt }],
            maxTokens,
            { stream: false, extractData: true, includePreset: false, includeInstruct: false },
        );
        const text = extractText(resp);
        if (!text) throw new Error('Empty answer');
        return text;
    }

    async function save(name, text) {
        const bytes = new TextEncoder().encode(text);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const res = await fetch('/api/files/upload', {
            method: 'POST',
            headers: ctx.getRequestHeaders(),
            body: JSON.stringify({ name: `onlytavern-gen-${name}.txt`, data: btoa(binary) }),
        });
        if (!res.ok) throw new Error(`Saving ${name} failed: ${res.status}`);
    }

    const log = [];
    const tagsText = await ask(section('Tags'));
    await save('tags', tagsText);
    const tags = JSON.parse(tagsText.replace(/^```(json)?|```$/gm, '').trim());
    log.push(`tags: ${tags.length}`);

    const languages = { en: 'English', zh: 'Simplified Chinese' };
    for (const [code, language] of Object.entries(languages)) {
        for (const [id, description] of Object.entries(segments)) {
            const prompt = commentsBody.replaceAll('{SEGMENT}', id).replace('{SEGMENT_DESCRIPTION}', description).replace('{LANGUAGE}', language);
            await save(`comments-${code}-${id}`, await ask(prompt));
            log.push(`comments ${code} ${id}`);
        }
        const tagList = tags.map((t) => `${t.id} (${t.en})`).join(', ');
        await save(`tagcomments-${code}`, await ask(section('Tag comments').replace('{LANGUAGE}', language).replace('{TAG_LIST}', tagList)));
        log.push(`tag comments ${code}`);
    }
    return log;
}
