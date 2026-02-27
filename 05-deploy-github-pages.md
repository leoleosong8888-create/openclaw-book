# 5) 모바일 친화 문서 사이트 배포 (GitHub Pages)

아래 방식이 가장 간단합니다.

## 5-1. 준비
- GitHub 저장소 1개 생성 (예: `openclaw-code-notes`)
- 이 폴더(`openclaw-analysis-site`) 내용을 루트에 업로드

필수 파일:
- `index.html`
- `_sidebar.md`
- `README.md`
- `01~05*.md`

## 5-2. 배포
1. GitHub 저장소 → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / folder: `/ (root)`
4. Save
5. 1~2분 후 `https://<계정>.github.io/<저장소명>/` 접속

## 5-3. 모바일 최적화 포인트
- docsify 기본 테마는 반응형이라 모바일에서 바로 읽기 가능
- 검색(search plugin) 포함됨
- 다크모드는 브라우저/테마 확장으로 사용 가능

## 5-4. 더 쉬운 대안

### Cloudflare Pages
- 저장소 연결만 하면 배포 완료
- CDN 빠름, 무료 플랜 충분

### Netlify
- 드래그&드롭으로 즉시 배포 가능
- 코드 저장소 연결 없이도 빠르게 링크 생성 가능

## 5-5. 보안 주의
- 내부 경로/토큰/민감 설정값은 문서에 넣지 않기
- 공개 저장소로 배포할 경우 시스템 세부 경로는 마스킹 권장
