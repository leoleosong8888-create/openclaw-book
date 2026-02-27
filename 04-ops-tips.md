# 4) 운영 팁 (디버깅 포인트, 수정 영향 범위)

## 4-1. 디버깅 시작점

1. `openclaw status --deep`
2. `openclaw health --json`
3. 로그 파일 확인 (`/tmp/openclaw/*.log` 또는 설정 경로)
4. 문제가 CLI 라우팅인지, Gateway인지, Tool 실행인지 분리

## 4-2. 영역별 체크리스트

### Core 문제 의심 시
- env 변수 충돌(`OPENCLAW_HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`)
- 프로필 인자(`--profile`, `--dev`) 혼용
- 경로 권한/존재 여부

### Gateway 문제 의심 시
- `--url`, `--token`, `--timeout`, `--expect-final`
- gateway가 실제 떠있는지 (`openclaw gateway status`)
- RPC method 이름/params 스키마 불일치

### Tools 문제 의심 시
- tool allow/deny 정책
- profile에 해당 도구 포함 여부
- 세션 문맥(채널/스레드/to) 누락

### LLM 문제 의심 시
- provider/model 파싱
- API key/인증 상태
- timeout 및 재시도 정책

## 4-3. 수정 시 영향 범위(중요)

- `entry.js` 성격의 core 코드 변경 → **거의 전 영역 영향**
- tool 카탈로그/정책 변경 → 권한/안전성 영향 큼
- gateway protocol 타입 변경 → CLI/서버/채널 동시 영향
- 라우팅(run-main) 변경 → 명령 체감 성능/동작 경로 변화

## 4-4. 실무 추천
- 번들(dist) 직접 수정 대신 원본 저장소(TypeScript) 수정 권장
- 변경 전후 최소 시나리오 테스트:
  - `status`, `health`, `cron list`
  - 메시지 송수신 1회
  - 도구 1~2개(read/exec/web_search)
