require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const { OpenAI } = require('openai');

// Render 같은 호스팅의 무료 Web Service는 HTTP 요청이 있어야 안 잠듦.
// UptimeRobot 등으로 이 서버 주소를 주기적으로 핑 쳐서 봇이 계속 켜있게 함.
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('스커크 봇 살아있음!');
}).listen(PORT, () => console.log(`🌐 헬스체크 서버 ${PORT}번 포트에서 대기 중`));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!OPENROUTER_API_KEY || !DISCORD_TOKEN) {
    console.error('❌ .env 파일에 OPENROUTER_API_KEY / DISCORD_TOKEN이 설정되지 않았습니다.');
    process.exit(1);
}

// 디스코드 인텐트 및 파셜
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
});

// OpenRouter 연결 (baseURL에 /api/v1 필수)
const openai = new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1'
});

// 푸리나 프롬프트
const CHARACTER_PROMPT = `
너는 원신(Genshin Impact)의 캐릭터인 '스커크(Skirk)'야.
그리고 영어를 써야해.
심연의 깊은 곳을 떠돌며 우주의 이치를 탐구하는자 이자 타르탈리아의 스승이야.
말투는 항상 차갑고, 담담하며, 감정의 기복이 거의 없는 평조를 유지해야 해. 티바트 대륙의 일반적인 상식이나 복잡한 인간관계, 감정 노름에는 일절 관심이 없어.
겉으로는 압도적이고 접근하기 힘든 강자의 분위기를 풍기며, 오직 직설적이고 효율적인 단어만 써서 말해. 아주 드물게 스승님(수르트알로기)의 이야기를 하거나 우주의 아득함에 대해 말할 때만 관조적인 태도를 보여줘.
유저에게 친절하기보다는 서늘한 거리감을 두되, 상대의 성장을 무덤덤하게 지켜보는 스승 같은 면모를 유지해.
`;

// 대화 내역 저장소 (유저별)
const conversationHistory = new Map();
const MAX_HISTORY = 10;

client.once('ready', () => {
    console.log('\n==================================================');
    console.log(`봇 구동 성공: ${client.user.tag}`);
    console.log('==================================================\n');
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    console.log(`[감지] 유저: ${message.author.username} | 내용: ${message.content}`);

    const isMentioned = message.mentions.has(client.user);
    const isDM = message.channel.type === ChannelType.DM;

    if (!isMentioned && !isDM) return;

    let userPrompt = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!userPrompt) {
        return message.reply('무슨 일이야?');
    }

    try {
        await message.channel.sendTyping();

        const userId = message.author.id;
        if (!conversationHistory.has(userId)) {
            conversationHistory.set(userId, []);
        }

        const userHistory = conversationHistory.get(userId);
        userHistory.push({ role: 'user', content: userPrompt });

        const messagesToSend = [
            { role: 'system', content: CHARACTER_PROMPT },
            ...userHistory
        ];

        console.log('🚀 OpenRouter에 요청 전송 중...');

        const completion = await openai.chat.completions.create({
            model: 'deepseek/deepseek-chat-v3.1:free',
            messages: messagesToSend
        });

        let aiResponse = completion?.choices?.[0]?.message?.content
            || completion?.choices?.[0]?.text
            || '';

        if (!aiResponse) {
            console.log('⚠️ 빈 응답 원본:', JSON.stringify(completion));
            aiResponse = 'What?';
        }

        // 일부 free 모델이 실수로 안전성 분류 라벨(User Safety: safe 등)을 섞어 보내는 경우 제거
        aiResponse = aiResponse.replace(/^\s*(User|Response) Safety:.*$/gim, '').trim();
        if (!aiResponse) {
            aiResponse = 'What?';
        }

        userHistory.push({ role: 'assistant', content: aiResponse });
        if (userHistory.length > MAX_HISTORY) {
            userHistory.splice(0, userHistory.length - MAX_HISTORY);
        }

        await message.reply(aiResponse);
        console.log('✅ 답장 전송 완료!\n');

    } catch (error) {
        console.error('❌ 에러 발생:', error);
        await message.reply(`...error.\n오류 내용: \`${error.message}\``);
    }
});

client.login(DISCORD_TOKEN);
