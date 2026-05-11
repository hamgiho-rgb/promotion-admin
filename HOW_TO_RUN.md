# 실행 방법 (처음 한 번만)

## 1. Node.js 설치 확인

이미 Node.js가 깔려있는지 확인:

```bash
node -v
```

버전이 나오면 OK. 없거나 오래된 버전이면 https://nodejs.org/en/download 에서 **LTS 버전** 설치하세요.

## 2. 의존성 설치 (처음 한 번만)

명령 프롬프트(CMD)나 PowerShell, 터미널 열고:

```bash
cd C:\Users\User\Desktop\COWORK\프로모션어드민
npm install
```

`node_modules/` 폴더가 만들어지고 패키지 다운로드. 1~2분 걸려요.

## 3. 개발 서버 실행

```bash
npm run dev
```

자동으로 브라우저가 열리고 `http://localhost:5173` 에 사이트가 뜸.

처음엔 로그인 화면이 나와요. **회원가입** 누르고 이메일/비밀번호 입력 → 본인 이메일로 인증 메일이 와요 → 인증 클릭하면 로그인 가능.

> ⚠️ Supabase Auth 기본 설정에서 이메일 인증이 켜져 있어요. 인증 메일이 안 오면:
> Supabase 대시보드 → Authentication → Providers → Email → "Confirm email" 토글을 끄면 인증 없이 바로 로그인 가능.

## 4. 코드 수정

VS Code 같은 에디터로 `C:\Users\User\Desktop\COWORK\프로모션어드민` 폴더 열고 수정.
저장하면 브라우저 자동 새로고침 (Hot Reload).

## 5. 개발 서버 종료

터미널에서 `Ctrl + C`

---

## 빌드 (배포용)

```bash
npm run build
```

`dist/` 폴더에 정적 파일이 생성됨. 이걸 Netlify에 올리면 됨 (다음 단계에서 GitHub 연동으로 자동화 예정).

---

## 자주 쓰는 명령어 정리

| 명령 | 설명 |
|---|---|
| `npm install` | 의존성 설치 (처음 한 번 + package.json 바뀔 때) |
| `npm run dev` | 개발 서버 시작 |
| `npm run build` | 배포용 빌드 |
| `npm run preview` | 빌드 결과를 로컬에서 미리보기 |

---

## 문제가 생기면

- **`node : 인식되지 않음` 에러** → Node.js 설치 안 됨. 위 1번 참고.
- **`npm install` 중간에 멈춤** → 인터넷 끊겼는지 확인. 다시 실행.
- **`localhost:5173` 안 열림** → 다른 프로그램이 5173 포트 쓰는 중. 콘솔 메시지 확인.
- **로그인이 안 됨** → Supabase 대시보드 → Authentication → Users 에서 가입 됐는지 확인.
