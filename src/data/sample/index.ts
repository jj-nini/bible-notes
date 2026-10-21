// Bundled sample so the app runs without Supabase.
// Ten verses only; texts are for UI testing and may differ from the published translations.
import type { Synonym, Translation, Verse, Version } from "../types";

export const sampleVersions: Version[] = [
  { code: "KRV", name: "개역개정", lang: "ko", translatable: false },
  { code: "AMP", name: "AMP", lang: "en", translatable: true },
  { code: "MSG", name: "MSG", lang: "en", translatable: true },
  { code: "NIV", name: "NIV", lang: "en", translatable: true },
];

type Row = [book: string, chapter: number, verse: number, krv: string, niv: string, msg: string, amp: string];

const ROWS: Row[] = [
  ["ISA", 41, 10,
    "두려워하지 말라 내가 너와 함께 함이라 놀라지 말라 나는 네 하나님이 됨이라 내가 너를 굳세게 하리라 참으로 너를 도와 주리라 참으로 나의 의로운 오른손으로 너를 붙들리라",
    "So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you; I will uphold you with my righteous right hand.",
    "Don't panic. I'm with you. There's no need to fear for I'm your God. I'll give you strength. I'll help you. I'll hold you steady, keep a firm grip on you.",
    "Do not fear [anything], for I am with you; do not be afraid, for I am your God. I will strengthen you, be assured I will help you; I will certainly take hold of you with My righteous right hand."],
  ["MAT", 11, 28,
    "수고하고 무거운 짐 진 자들아 다 내게로 오라 내가 너희를 쉬게 하리라",
    "Come to me, all you who are weary and burdened, and I will give you rest.",
    "Are you tired? Worn out? Burned out on religion? Come to me. Get away with me and you'll recover your life. I'll show you how to take a real rest.",
    "Come to Me, all who are weary and heavily burdened [by religious rituals that provide no peace], and I will give you rest [refreshing your souls with salvation]."],
  ["MAT", 11, 29,
    "나는 마음이 온유하고 겸손하니 나의 멍에를 메고 내게 배우라 그리하면 너희 마음이 쉼을 얻으리니",
    "Take my yoke upon you and learn from me, for I am gentle and humble in heart, and you will find rest for your souls.",
    "Walk with me and work with me—watch how I do it. Learn the unforced rhythms of grace.",
    "Take My yoke upon you and learn from Me [following Me as My disciple], for I am gentle and humble in heart, and you will find rest (renewal, blessed quiet) for your souls."],
  ["MAT", 11, 30,
    "이는 내 멍에는 쉽고 내 짐은 가벼움이라 하시니라",
    "For my yoke is easy and my burden is light.",
    "I won't lay anything heavy or ill-fitting on you. Keep company with me and you'll learn to live freely and lightly.",
    "For My yoke is easy [to bear] and My burden is light."],
  ["PHP", 4, 4,
    "주 안에서 항상 기뻐하라 내가 다시 말하노니 기뻐하라",
    "Rejoice in the Lord always. I will say it again: Rejoice!",
    "Celebrate God all day, every day. I mean, revel in him!",
    "Rejoice in the Lord always [delight, take pleasure in Him]; again I will say, rejoice!"],
  ["PHP", 4, 5,
    "너희 관용을 모든 사람에게 알게 하라 주께서 가까우시니라",
    "Let your gentleness be evident to all. The Lord is near.",
    "Make it as clear as you can to all you meet that you're on their side, working with them and not against them. Help them see that the Master is about to arrive. He could show up any minute!",
    "Let your gentle spirit [your graciousness, unselfishness, mercy, tolerance, and patience] be known to all people. The Lord is near."],
  ["PHP", 4, 6,
    "아무 것도 염려하지 말고 다만 모든 일에 기도와 간구로 너희 구할 것을 감사함으로 하나님께 아뢰라",
    "Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God.",
    "Don't fret or worry. Instead of worrying, pray. Let petitions and praises shape your worries into prayers, letting God know your concerns.",
    "Do not be anxious or worried about anything, but in everything [every circumstance and situation] by prayer and petition with thanksgiving, continue to make your [specific] requests known to God."],
  ["PHP", 4, 7,
    "그리하면 모든 지각에 뛰어난 하나님의 평강이 그리스도 예수 안에서 너희 마음과 생각을 지키시리라",
    "And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.",
    "Before you know it, a sense of God's wholeness, everything coming together for good, will come and settle you down. It's wonderful what happens when Christ displaces worry at the center of your life.",
    "And the peace of God [that peace which reassures the heart, that peace] which transcends all understanding, [that peace which] stands guard over your hearts and your minds in Christ Jesus [is yours]."],
  ["PHP", 4, 8,
    "끝으로 형제들아 무엇에든지 참되며 무엇에든지 경건하며 무엇에든지 옳으며 무엇에든지 정결하며 무엇에든지 사랑 받을 만하며 무엇에든지 칭찬 받을 만하며 무슨 덕이 있든지 무슨 기림이 있든지 이것들을 생각하라",
    "Finally, brothers and sisters, whatever is true, whatever is noble, whatever is right, whatever is pure, whatever is lovely, whatever is admirable—if anything is excellent or praiseworthy—think about such things.",
    "Summing it all up, friends, I'd say you'll do best by filling your minds and meditating on things true, noble, reputable, authentic, compelling, gracious—the best, not the worst; the beautiful, not the ugly; things to praise, not things to curse.",
    "Finally, believers, whatever is true, whatever is honorable and worthy of respect, whatever is right and confirmed by God's word, whatever is pure and wholesome, whatever is lovely and brings peace, whatever is admirable and of good repute; if there is any excellence, if there is anything worthy of praise, think continually on these things [center your mind on them, and implant them in your heart]."],
  ["PHP", 4, 9,
    "너희는 내게 배우고 받고 듣고 본 바를 행하라 그리하면 평강의 하나님이 너희와 함께 계시리라",
    "Whatever you have learned or received or heard from me, or seen in me—put it into practice. And the God of peace will be with you.",
    "Put into practice what you learned from me, what you heard and saw and realized. Do that, and God, who makes everything work together, will work you into his most excellent harmonies.",
    "The things which you have learned and received and heard and seen in me, practice these things [in daily life], and the God [who is the source] of peace and well-being will be with you."],
];

export const sampleVerses: Verse[] = ROWS.flatMap(([book, chapter, verse, KRV, NIV, MSG, AMP]) =>
  Object.entries({ KRV, NIV, MSG, AMP }).map(([version, text]) => ({ version, book, chapter, verse, text })),
);

/** What the mock translator returns. Keyed "VERSION|BOOK.CH.V". */
export const sampleMachineTranslations: Record<string, string> = {
  "MSG|ISA.41.10": "당황하지 마라. 내가 너와 함께 있다. 두려워할 것 없다, 내가 네 하나님이니. 내가 힘을 주고, 도와주고, 흔들리지 않게 꽉 붙잡아 주겠다.",
  "AMP|ISA.41.10": "[무엇도] 두려워하지 말라, 내가 너와 함께 있음이라. 겁내지 말라, 나는 네 하나님이라. 내가 너를 강하게 하리니, 반드시 너를 도우리라. 내가 나의 의로운 오른손으로 너를 확실히 붙들리라.",
  "MSG|MAT.11.28": "피곤한가요? 지쳤나요? 종교에 진이 빠졌나요? 내게 오세요. 나와 함께 떠나면 삶을 되찾게 될 거예요. 진짜 쉼이 무엇인지 보여 줄게요.",
  "AMP|MAT.11.28": "수고하고 무거운 짐을 진 [평안을 주지 못하는 종교 의식에 짓눌린] 모든 자들아 내게로 오라. 내가 너희에게 쉼을 주리라 [구원으로 너희 영혼을 새롭게 하리라].",
  "MSG|MAT.11.29": "나와 함께 걷고 나와 함께 일하세요. 내가 어떻게 하는지 지켜보세요. 억지로 하지 않는 은혜의 리듬을 배우세요.",
  "AMP|MAT.11.29": "내 멍에를 메고 내게 배우라 [내 제자로서 나를 따르라]. 나는 마음이 온유하고 겸손하니 너희 영혼이 쉼(새로워짐, 복된 고요)을 얻으리라.",
  "MSG|MAT.11.30": "무겁거나 맞지 않는 짐을 지우지 않을게요. 나와 함께 지내면 자유롭고 가볍게 사는 법을 배우게 될 거예요.",
  "AMP|MAT.11.30": "이는 내 멍에는 [지기] 쉽고 내 짐은 가벼움이라.",
  "MSG|PHP.4.4": "하루 종일, 날마다 하나님을 기뻐하세요. 정말이에요, 그분 안에서 마음껏 즐거워하세요!",
  "AMP|PHP.4.4": "주 안에서 항상 기뻐하라 [그분을 즐거워하고 그분으로 기뻐하라]. 내가 다시 말하노니 기뻐하라!",
  "MSG|PHP.4.5": "만나는 모든 사람에게 여러분이 그들 편이며, 맞서지 않고 함께 일한다는 것을 분명히 보여 주세요. 주님이 곧 오신다는 것을 알게 해 주세요. 언제라도 오실 수 있습니다!",
  "AMP|PHP.4.5": "너희의 온유한 마음 [너희의 너그러움, 이타심, 자비, 관용, 인내]을 모든 사람에게 알게 하라. 주께서 가까우시니라.",
  "MSG|PHP.4.6": "안달하거나 걱정하지 마세요. 걱정하는 대신 기도하세요. 간구와 찬양으로 걱정을 기도로 바꾸어, 하나님께 마음의 짐을 알려 드리세요.",
  "AMP|PHP.4.6": "아무것도 불안해하거나 걱정하지 말고, 모든 일에 [모든 상황과 형편 속에서] 기도와 간구와 감사로 너희의 [구체적인] 요청을 계속해서 하나님께 아뢰라.",
  "MSG|PHP.4.7": "어느새 하나님의 온전하심, 모든 것이 선을 이루며 하나로 모이는 그 느낌이 찾아와 여러분을 진정시킬 것입니다. 그리스도께서 삶의 중심에서 걱정을 몰아내실 때 일어나는 일은 정말 놀랍습니다.",
  "AMP|PHP.4.7": "그리하면 모든 이해를 뛰어넘는 하나님의 평강 [마음을 안심시키는 그 평강]이 그리스도 예수 안에서 너희 마음과 생각을 지키리라 [그 평강이 너희 것이라].",
  "MSG|PHP.4.8": "결론적으로, 친구 여러분, 참되고 고귀하고 존경받을 만하고 진실하고 마음을 끌고 은혜로운 것들로 생각을 채우고 묵상하는 것이 가장 좋습니다. 최악이 아닌 최선을, 추한 것이 아닌 아름다운 것을, 저주할 것이 아닌 찬양할 것을 생각하세요.",
  "AMP|PHP.4.8": "끝으로 믿는 이들아, 무엇이든지 참되고, 존귀하며 존경받을 만하고, 옳고 하나님의 말씀으로 확증되며, 순결하고 건전하며, 사랑스럽고 평안을 주며, 칭찬받을 만하고 평판이 좋은 것이라면, 어떤 덕이나 칭찬할 만한 것이 있다면 이것들을 계속 생각하라 [마음을 거기에 두고 마음에 심으라].",
  "MSG|PHP.4.9": "내게서 배우고, 듣고, 보고, 깨달은 것을 실천하세요. 그렇게 하면 모든 것이 함께 어우러지게 하시는 하나님께서 여러분을 그분의 가장 훌륭한 화음 속으로 이끌어 주실 것입니다.",
  "AMP|PHP.4.9": "너희가 내게서 배우고 받고 듣고 본 것들을 [일상에서] 실천하라. 그리하면 평강과 안녕의 [근원이신] 하나님이 너희와 함께 계시리라.",
};

/** Translations already "in the DB" on first run. */
export const sampleTranslationSeed: Translation[] = [
  { version: "MSG", book: "PHP", chapter: 4, verse: 6, status: "fixed", edited: false, engine: "sample", text: sampleMachineTranslations["MSG|PHP.4.6"] },
  { version: "AMP", book: "PHP", chapter: 4, verse: 6, status: "machine", edited: false, engine: "sample", text: sampleMachineTranslations["AMP|PHP.4.6"] },
  { version: "MSG", book: "PHP", chapter: 4, verse: 7, status: "machine", edited: false, engine: "sample", text: sampleMachineTranslations["MSG|PHP.4.7"] },
  { version: "MSG", book: "MAT", chapter: 11, verse: 28, status: "fixed", edited: false, engine: "sample", text: sampleMachineTranslations["MSG|MAT.11.28"] },
];

// Topic dictionary (built with an LLM at design time; plain lookups at runtime)
const SYN: Record<string, string[]> = {
  "염려": ["염려", "걱정", "근심", "불안", "초조"],
  "두려움": ["두려", "무섭", "무서", "겁", "불안"],
  "지침": ["지침", "지쳤", "지친", "피곤", "번아웃", "힘들", "힘든"],
  "쉼": ["쉼", "쉬고", "휴식", "지쳤", "지친", "번아웃"],
  "감사": ["감사", "고마"],
  "위로": ["위로", "슬픔", "슬플", "외로"],
  "평안": ["평안", "평강"],
  "기쁨": ["기쁨", "기뻐", "기쁘"],
  "기도": ["기도"],
};
export const sampleSynonyms: Synonym[] = Object.entries(SYN).flatMap(([topic, terms]) =>
  terms.map((term) => ({ term, topic })),
);

export const sampleVerseTopics: { book: string; chapter: number; verse: number; topic: string; weight: number }[] = [
  { book: "PHP", chapter: 4, verse: 6, topic: "염려", weight: 0.95 },
  { book: "PHP", chapter: 4, verse: 6, topic: "기도", weight: 0.8 },
  { book: "PHP", chapter: 4, verse: 6, topic: "감사", weight: 0.7 },
  { book: "PHP", chapter: 4, verse: 7, topic: "평안", weight: 0.95 },
  { book: "PHP", chapter: 4, verse: 7, topic: "염려", weight: 0.6 },
  { book: "PHP", chapter: 4, verse: 4, topic: "기쁨", weight: 0.95 },
  { book: "PHP", chapter: 4, verse: 9, topic: "평안", weight: 0.7 },
  { book: "ISA", chapter: 41, verse: 10, topic: "두려움", weight: 0.95 },
  { book: "ISA", chapter: 41, verse: 10, topic: "위로", weight: 0.7 },
  { book: "MAT", chapter: 11, verse: 28, topic: "지침", weight: 0.95 },
  { book: "MAT", chapter: 11, verse: 28, topic: "쉼", weight: 0.9 },
  { book: "MAT", chapter: 11, verse: 28, topic: "위로", weight: 0.75 },
  { book: "MAT", chapter: 11, verse: 29, topic: "쉼", weight: 0.85 },
];
