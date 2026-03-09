# AI 활용 / Skills - OpenClaw Skill Registry

기준 경로:
- `~/.npm-global/lib/node_modules/openclaw/skills`

총 스킬 수: **52개**

## 전체 목록
- 1password
- apple-notes
- apple-reminders
- bear-notes
- blogwatcher
- blucli
- bluebubbles
- camsnap
- canvas
- clawhub
- coding-agent
- discord
- eightctl
- gemini
- gh-issues
- gifgrep
- github
- gog
- goplaces
- healthcheck
- himalaya
- imsg
- mcporter
- model-usage
- nano-banana-pro
- nano-pdf
- notion
- obsidian
- openai-image-gen
- openai-whisper
- openai-whisper-api
- openhue
- oracle
- ordercli
- peekaboo
- sag
- session-logs
- sherpa-onnx-tts
- skill-creator
- slack
- songsee
- sonoscli
- spotify-player
- summarize
- things-mac
- tmux
- trello
- video-frames
- voice-call
- wacli
- weather
- xurl

---

## 빠른 분류 (운영 관점)

### 1) 메시징/커뮤니케이션
- discord, slack, imsg, bluebubbles, wacli, voice-call

### 2) 생산성/문서/노트
- notion, obsidian, bear-notes, apple-notes, apple-reminders, trello, things-mac

### 3) 개발/코딩/운영
- coding-agent, github, gh-issues, tmux, session-logs, healthcheck, model-usage

### 4) AI 멀티모달
- openai-image-gen, openai-whisper, openai-whisper-api, sherpa-onnx-tts, video-frames, summarize

### 5) 디바이스/환경 제어
- canvas, camsnap, openhue, sonoscli

### 6) 검색/웹/유틸
- xurl, blogwatcher, clawhub, gifgrep, goplaces, gog

---

## 실무 팁
- 거대한 단일 에이전트보다, 위 스킬들을 **용도별 조합**으로 운영하면 유지보수가 쉬움
- 작업 표준화가 필요하면 `skill-creator`로 팀 공통 스킬 패키징 권장
- 음성/영상 요약은 `summarize` + `openai-whisper-api` 조합이 안정적
