# Yoonseok Heo — Personal Homepage

정적 HTML/CSS/JS로 만든 개인 홈페이지입니다. 별도 빌드 도구 없이 바로 열 수 있습니다.

## 구조

```
index.html          홈 (Hero · News · About · Research Areas · Selected Publications · Teaching · Contact)
publications.html   전체 논문 목록 (연도별, 카테고리 필터)
teaching.html       강의 목록 (2026 Fall / Spring, 강의계획서 PDF)
members.html        구성원 (교수 · 대학원생 · 학부 인턴)
projects.html       연구 과제
css/style.css       스타일
js/data.js          논문 데이터 (여기만 수정하면 홈/논문 페이지에 모두 반영)
js/main.js          렌더링 스크립트
assets/img/         프로필 사진
assets/pdf/         강의계획서, 논문 PDF, 포스터
```

## 로컬에서 보기

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## 논문 추가하기

`js/data.js`의 `PUBS` 배열에 항목을 추가합니다.

```js
{
  year: 2026, type: "conference",      // journal | conference | domestic | preprint
  venue: "ACL 2026", hot: true,        // hot: 🔥 배지
  title: "...", authors: "..., Yoonseok Heo*", where: "...",
  links: [{label: "PDF", href: "assets/pdf/xxx.pdf"}],   // {label:"Scholar", scholar:true} 도 가능
  cites: 0, selected: true             // selected: 홈 화면 노출
}
```

## 배포 (GitHub Pages)

1. GitHub에 저장소를 만들고 이 폴더를 push
2. Settings → Pages → Branch: `main` / root 선택
3. `https://<계정>.github.io/<저장소>/` 에서 확인
