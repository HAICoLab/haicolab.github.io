# HAICoLab — Human-AI Collaboration Lab

서강대학교 HAICoLab의 정적 HTML/CSS/JavaScript 홈페이지입니다. GitHub Pages가 `main` 브랜치의 루트에서 배포합니다. 기존 도메인은 `CNAME`에서 관리합니다.

## 도메인 설정 보존

루트의 `CNAME`은 홈페이지 운영에 필요한 파일이며, Git에 계속 포함해야 합니다. 파일명은 대문자 `CNAME`, 내용은 아래 한 줄을 유지합니다.

```text
haicolab.sogang.ac.kr
```

- 명시적인 도메인 변경 요청이 없다면 삭제·이동·이름 변경·내용 변경을 하지 않습니다. `.gitignore`에도 추가하지 않습니다.
- 홈페이지 전체 교체, 빌드 결과 업로드, 이전 버전 복원 시에도 이 파일을 보존합니다. 작업 전 원격 저장소의 최신 변경 사항을 먼저 반영합니다.
- 커밋·푸시 전에 `CNAME`의 Git 추적 여부, 도메인 값, 삭제·변경 여부를 확인합니다. 배포 후에는 실제 도메인 `https://haicolab.sogang.ac.kr/`로 접속을 확인합니다.
- GitHub Pages의 Custom domain과 조직의 Verified domain 설정, 학교 DNS의 CNAME 및 인증용 TXT 레코드를 유지합니다.

AI 작업자를 위한 동일한 보존 규칙은 [AGENTS.md](AGENTS.md)에 명시되어 있습니다. 자세한 설정 요건은 [GitHub의 사용자 지정 도메인 문제 해결 안내](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/troubleshooting-custom-domains-and-github-pages)를 참고하세요.

## 페이지와 언어

기본 화면은 KR이며 Contact 옆 LANG 메뉴에서 🇰🇷 KR / 🇺🇸 EN을 선택합니다. 언어 전환 시 현재 페이지, 세부 섹션, 논문 필터를 유지합니다.

- `index.html`: 교수 소개, 성과 요약, 네 연구 분야, 최신 News·Awards, Lab Recruitment
- `members.html`: Professor, Research Background, Students, Alumni
- `research.html`: 연구 분야별 상세 소개와 최신 관련 논문 최대 3편
- `publications.html`: 전체 논문과 연구 분야·출판 유형 조합 필터
- `news.html`, `awards.html`: 전체 소식과 수상 기록
- `projects.html`, `teaching.html`, `contact.html`: 과제, 강의, 연락처
- `en/*.html`: 영어 페이지
- `courses/`, `assets/`: 기존 강의 사이트와 사진·논문·강의계획서 자료

## 콘텐츠 관리

`js/data.js`의 `PUBS`가 논문 목록과 성과 집계의 공통 데이터입니다.

- `type`: `journal`, `conference`, `workshop`, `domestic`, `preprint`
- `areas`: `knowledge`, `pluralism`, `creativity`, `learning` 중 하나 이상
- `indexing`: 저널에만 `SCIE` 또는 `KCI` 지정
- `AWARDS`: 날짜 내림차순으로 홈에는 최대 3건, Awards 페이지에는 전체 기록 표시

영문 논문·수상 표기는 `en/js/data-en.js`에서 관리합니다. 한국어 논문은 영문·한글 제목을 병기하며, 직접 번역한 제목은 번역임을 표시합니다. 한국인 구성원 이름은 영문·한글을 함께 표시합니다.

## 영문 페이지 갱신

`scripts/build-english.cjs`는 루트 페이지의 레이아웃을 기반으로 영문 페이지를 생성합니다. 영문 본문을 수정하려면 이 파일의 번역 문구를 수정한 뒤 실행합니다.

```sh
npm install
npm run build:english
```

이미 생성된 HTML이 포함되어 있으므로 배포 시 별도 빌드는 필요하지 않습니다. `.nojekyll`로 정적 파일을 그대로 제공합니다. 기존 강의 사이트와 PDF는 원문 언어로 유지합니다.

## 로컬 확인

```sh
python3 -m http.server 8000
```

KR: `http://localhost:8000/` · EN: `http://localhost:8000/en/index.html`
