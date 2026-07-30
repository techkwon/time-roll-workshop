export type TimeRollThemeId =
  | "manufacturing"
  | "construction"
  | "transport"
  | "communication"
  | "life";

export type TimeRollUiLine = string;

export type TimeRollProtagonist = {
  id: "tori";
  name: string;
  model: string;
  role: string;
  callout: TimeRollUiLine;
};

export type TimeRollWorldPremise = {
  title: TimeRollUiLine;
  lines: readonly [TimeRollUiLine, TimeRollUiLine, TimeRollUiLine];
};

export type TimeRollIntroTeaser = {
  kicker: TimeRollUiLine;
  title: readonly [TimeRollUiLine, TimeRollUiLine];
  tagline: TimeRollUiLine;
  tip: TimeRollUiLine;
};

export type TimeRollEraStory = {
  id: TimeRollThemeId;
  order: number;
  themeLabel: string;
  eraName: string;
  missionTitle: TimeRollUiLine;
  missionBriefing: readonly [TimeRollUiLine, TimeRollUiLine];
  bossLabel: TimeRollUiLine;
  bossWarning: TimeRollUiLine;
  clearTitle: TimeRollUiLine;
  clearLines: readonly [TimeRollUiLine, TimeRollUiLine];
};

export type TimeRollEnding = {
  eyebrow: TimeRollUiLine;
  title: TimeRollUiLine;
  lines: readonly [TimeRollUiLine, TimeRollUiLine, TimeRollUiLine, TimeRollUiLine];
};

export const TIME_ROLL_PROTAGONIST: TimeRollProtagonist = {
  id: "tori",
  name: "로봇 토리",
  model: "TR-05",
  role: "시간 구슬 조종 로봇",
  callout: "작게 굴러 크게 고치는 로봇",
} as const;

export const TIME_ROLL_WORLD_PREMISE: TimeRollWorldPremise = {
  title: "멈춘 시간동력핵을 되살려라",
  lines: [
    "미래 도시의 시간동력핵이 멈췄어요.",
    "토리는 다섯 시대의 기술 코어를 모읍니다.",
    "제조, 건설, 수송, 통신, 생명이 하나로 이어집니다.",
  ],
} as const;

export const TIME_ROLL_INTRO_TEASER: TimeRollIntroTeaser = {
  kicker: "시간 수리 로봇 토리 · 다섯 시대 · 거대 코어",
  title: ["데굴데굴", "시간공작소"],
  tagline: "손바닥만 한 시간 구슬로 미래 엔진을 켜요.",
  tip: "각 시대의 거대 코어까지 굴려 모으세요.",
} as const;

export const TIME_ROLL_ERA_STORIES = [
  {
    id: "manufacturing",
    order: 1,
    themeLabel: "제조",
    eraName: "손으로 만드는 마을",
    missionTitle: "제조 코어를 깨워라",
    missionBriefing: ["첫 시대는 만드는 힘이에요.", "손도구와 부품을 굴려 모아요."],
    bossLabel: "거대 물레방아",
    bossWarning: "거대 물레방아가 마지막 코어를 지켜요.",
    clearTitle: "제조 코어 복구!",
    clearLines: ["작은 도구가 큰 기계의 씨앗이 됐어요.", "이제 도시를 세울 힘이 열렸어요."],
  },
  {
    id: "construction",
    order: 2,
    themeLabel: "건설",
    eraName: "기계가 움직이는 도시",
    missionTitle: "건설 코어를 세워라",
    missionBriefing: ["기계 도시는 튼튼한 뼈대가 필요해요.", "벽돌과 장비를 모아 구조를 완성해요."],
    bossLabel: "도시 크레인",
    bossWarning: "도시 크레인이 높은 길을 막고 있어요.",
    clearTitle: "건설 코어 완성!",
    clearLines: ["튼튼한 도시는 다음 길을 만들었어요.", "이제 더 먼 세계로 출발해요."],
  },
  {
    id: "transport",
    order: 3,
    themeLabel: "수송",
    eraName: "길과 바다가 이어진 세상",
    missionTitle: "수송 코어를 달려라",
    missionBriefing: ["이어진 길이 세상을 넓혀요.", "바퀴, 배, 열차의 힘을 모아요."],
    bossLabel: "대륙 횡단 열차",
    bossWarning: "대륙 횡단 열차가 속도 코어를 품었어요.",
    clearTitle: "수송 코어 질주!",
    clearLines: ["길과 바다가 하나의 지도가 됐어요.", "이제 신호를 보내 지구를 잇어요."],
  },
  {
    id: "communication",
    order: 4,
    themeLabel: "통신",
    eraName: "정보가 날아다니는 지구",
    missionTitle: "통신 코어를 연결하라",
    missionBriefing: ["멀리 있는 마음도 신호로 만나요.", "전화, 위성, 데이터를 모아 지구를 잇어요."],
    bossLabel: "지구 통신 위성",
    bossWarning: "지구 통신 위성이 연결 코어를 비춰요.",
    clearTitle: "통신 코어 연결!",
    clearLines: ["신호가 도시와 도시를 빠르게 이었어요.", "이제 생명이 자라는 미래로 가요."],
  },
  {
    id: "life",
    order: 5,
    themeLabel: "생명",
    eraName: "생명과 기술이 함께 사는 미래",
    missionTitle: "생명 코어를 살려라",
    missionBriefing: ["미래는 기술과 생명이 함께 자라요.", "씨앗, 의료, 생태 기술을 모아요."],
    bossLabel: "미래 생태돔",
    bossWarning: "미래 생태돔이 마지막 생명 코어예요.",
    clearTitle: "생명 코어 개방!",
    clearLines: ["기술이 숲과 사람을 함께 지켰어요.", "토리의 시간 엔진이 다시 빛나요."],
  },
] as const satisfies readonly TimeRollEraStory[];

export const TIME_ROLL_BOSS_LABELS: Record<TimeRollThemeId, TimeRollUiLine> = {
  manufacturing: "거대 물레방아",
  construction: "도시 크레인",
  transport: "대륙 횡단 열차",
  communication: "지구 통신 위성",
  life: "미래 생태돔",
} as const;

export const TIME_ROLL_ENDING: TimeRollEnding = {
  eyebrow: "다섯 시대 여행 성공",
  title: "시간 전시관 완성!",
  lines: [
    "제조가 만들고, 건설이 세웠어요.",
    "수송이 잇고, 통신이 나누었어요.",
    "생명 기술이 미래를 숨 쉬게 했어요.",
    "로봇 토리의 시간 엔진이 다시 빛나요.",
  ],
} as const;

export function getTimeRollEraStory(id: TimeRollThemeId) {
  return TIME_ROLL_ERA_STORIES.find((story) => story.id === id);
}
