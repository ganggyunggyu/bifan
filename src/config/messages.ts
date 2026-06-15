/**
 * 30주년 감사 메시지 (Screen 3). 단락별 순차 fade-in.
 * 문구 변경 시 이 배열만 수정하면 됩니다.
 */
export const ANNIVERSARY_MESSAGES: string[] = [
  '30년의 이야기들이 시간을 지나,\n이곳 부천으로 모였습니다.',
  '30회의 부천국제판타스틱영화제가\n여러분 곁에 있을 수 있었던 것은,\n이곳에 모인 소중한 마음들 덕분입니다.',
  '그리고 지금, 우리 눈앞에 영화의 미래로\n향하는 문이 열립니다.',
  '함께 만들어갈 새로운 이야기의 주인공으로,\n여러분을 초대합니다.',
];

// 단락 간 등장 간격 (ms).
export const MESSAGE_INTERVAL_MS = 3500;

// 마지막 단락 등장 후 다음 화면으로 넘어가기까지 대기 (ms).
export const MESSAGE_OUTRO_MS = 3000;
