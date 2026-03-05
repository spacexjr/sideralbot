import Groq from 'groq-sdk';

const apiKey = process.env.GROQ_API_KEY;
const preferredModel = process.env.GROQ_MODEL;
let quotaCooldownUntil = 0;
let lastQuotaLogAt = 0;

const systemPrompt =
    'Você é um assistente de IA de um servidor de Minecraft Bedrock. ' +
    'Responda em português, de forma amigável, objetiva e curta.';

function clampTo200(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= 200) return clean;
    return `${clean.slice(0, 197)}...`;
}

function parseRetryMs(err) {
    const retryAfterHeader = err?.retryAfter || err?.headers?.['retry-after'];
    if (retryAfterHeader && !Number.isNaN(Number(retryAfterHeader))) {
        return Math.ceil(Number(retryAfterHeader) * 1000);
    }

    const msgMatch = String(err?.message || '').match(/retry(?:\s+after|\s+in)?\s*([\d.]+)s/i);
    if (msgMatch) return Math.ceil(Number(msgMatch[1])) * 1000;
    return 60000;
}

async function requestGroq(modelName, userPrompt) {
    const client = new Groq({ apiKey });
    const completion = await client.chat.completions.create({
        model: modelName,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.6,
        max_tokens: 120
    });
    return completion?.choices?.[0]?.message?.content || 'Sem resposta no momento.';
}

export async function askAI(prompt) {
    const userPrompt = String(prompt || '').trim();
    if (!userPrompt) return 'Escreva uma pergunta após !c.';
    if (!apiKey) return 'IA indisponível: configure GROQ_API_KEY.';
    if (Date.now() < quotaCooldownUntil) {
        const remainingSec = Math.max(1, Math.ceil((quotaCooldownUntil - Date.now()) / 1000));
        return `IA em pausa por limite de uso. Tente em ${remainingSec}s.`;
    }

    try {
        const modelCandidates = [
            preferredModel,
            'llama-3.3-70b-versatile',
            'llama-3.1-8b-instant'
        ].filter((m, i, arr) => m && arr.indexOf(m) === i);

        for (const modelName of modelCandidates) {
            try {
                const text = await requestGroq(modelName, userPrompt);
                return clampTo200(text);
            } catch (err) {
                const isNotFound = err?.status === 404;
                if (!isNotFound) throw err;
            }
        }

        return 'Modelo IA indisponível no momento.';
    } catch (err) {
        if (err?.status === 429) {
            const retryMs = parseRetryMs(err);
            quotaCooldownUntil = Date.now() + retryMs;
            if (Date.now() - lastQuotaLogAt > 10000) {
                console.warn(`askAI quota limitada (429). Nova tentativa em ${Math.ceil(retryMs / 1000)}s.`);
                lastQuotaLogAt = Date.now();
            }
            const retrySec = Math.max(1, Math.ceil(retryMs / 1000));
            return `IA sem cota no momento. Tente em ${retrySec}s.`;
        }

        console.error('askAI error:', err);
        return 'Falha ao consultar IA. Tente novamente.';
    }
}
