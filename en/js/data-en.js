// English presentation overrides. Shared publication and award records remain in ../../js/data.js.
(function () {
  var names = {'조소영':'Soyoung Cho (조소영)','이서우':'Seowoo Lee (이서우)','남고은':'Goeun Nam (남고은)','김현재':'Hyunjae Kim (김현재)','허윤석':'Yoonseok Heo (허윤석)'};
  window.PUBS = window.PUBS.map(function (original) {
    var p = Object.assign({}, original);
    if (p.venue === 'HCLT 2026 · Oral') {
      p.subtitle = p.title;
      p.title = 'Evaluating Agents’ Regulatory Retrieval Using a Synthetic Benchmark Based on Broadcast Review Violations';
      p.titleNote = 'English title translated from Korean';
      p.award = 'Best Paper Award';
      p.where = '38th Annual Conference on Human and Cognitive Language Technology (HCLT 2026) · Busan, Korea · October 7–8, 2026 · Oral presentation';
    } else if (p.venue === 'KCC 2026') {
      p.title = original.subtitle; p.subtitle = original.title;
      p.award = 'Outstanding Undergraduate Paper Award (Encouragement Prize)';
      p.areaNote = 'Narrative Analysis · Foundational research relevant to co-creativity';
      p.where = 'Korea Computer Congress (KCC 2026) · Korean Institute of Information Scientists and Engineers (KIISE)';
    } else if (p.venue === 'KINGPC') {
      p.subtitle = '자동 스토리라인 생성기를 활용한 AI 기반 스토리 생성 프레임워크';
      p.titleNote = 'Korean title translated from the listed English title';
      p.where = 'Conference of the Korean Institute of Next Generation Computing, pp. 57–60';
    } else if (p.venue === 'HCLT 2016') {
      p.subtitle = '가중 투표 기반 앙상블 기법을 이용한 한국어 개체명 인식기';
      p.titleNote = 'Korean title translated from the listed English title';
      p.where = 'Proceedings of HCLT 2016, pp. 333–336';
    }
    // Preserve published author spellings and initials where full Korean names are unavailable.
    if (/[가-힣]/.test(p.authors)) p.authors=p.authors.replace(/조소영|이서우|남고은|김현재|허윤석/g,function(n){return names[n];});
    else p.authors=p.authors.replace(/Yoonseok Heo(\*?)|Y\. Heo/g,function(_,star){return 'Yoonseok Heo'+(star||'')+' (허윤석)';});
    p.links=(p.links||[]).map(function(l){return Object.assign({},l,{href:l.href && l.href.indexOf('assets/')===0?'../'+l.href:l.href});});
    return p;
  });
  var hcltKo='방송심의 위반 사례 기반 합성 벤치마크를 활용한 에이전트 규정 검색 평가';
  var kccKo='헤밍웨이 단편 소설에 대한 LLM 기반 서사 기능 전이 패턴 분석과 문학 비평의 정합성 검증';
  var details = {
    '2026-10-07': {
      name:'Best Paper Award', heading:'HCLT 2026', venue:'38th Annual Conference on Human and Cognitive Language Technology',
      work:'Evaluating Agents’ Regulatory Retrieval Using a Synthetic Benchmark Based on Broadcast Review Violations', korean:hcltKo,
      context:'Oral presentation · October 7–8, 2026 · Busan, Korea',
      who:'<b>'+names['조소영']+'</b>, '+names['허윤석']+' · <a href="publications.html?area=knowledge">Publication ↗</a>',
      by:'Organized by the KIISE Special Interest Group on Language Technology and the Korean Society for Language and Information'
    },
    '2026-09-11': {
      name:'Merit Award',heading:'2026 Sogang AI Driven University Idea Fair',venue:'Sogang University',
      work:'Librarian–AI Collaboration Agent for Library Classification Decisions',context:'',
      who:'Team <b>Sogang renAIssance</b> — '+[names['남고은'],names['조소영'],names['이서우'],names['김현재'],names['허윤석']].join(', '),
      by:'Organized by Sogang University’s Digital Information Office, RISE Program, and AI University Program · <a href="https://contest.sogang.ac.kr/" target="_blank" rel="noopener">Competition ↗</a> · <a href="https://github.com/HAICoLab/sogang_renAIssance/tree/main" target="_blank" rel="noopener">Code ↗</a>'
    },
    '2026-06-26': {
      name:'Outstanding Undergraduate Paper Award (Encouragement Prize)',heading:'KCC 2026',venue:'Korea Computer Congress',
      work:'An LLM-Based Analysis of Narrative Function Transition Patterns in Hemingway’s Short Stories and Their Alignment with Literary Criticism',korean:kccKo,context:'',
      who:'<b>'+names['이서우']+', '+names['남고은']+'</b>, '+names['허윤석']+' · <a href="publications.html?area=creativity">Publication ↗</a>',
      by:'Organized by the Korean Institute of Information Scientists and Engineers (KIISE)'
    }
  };
  window.AWARDS=window.AWARDS.map(function(a){var d=details[a.date];if(!d)return a;return {date:a.date,markup:'<div class="award"><div class="medal">🏅</div><div><div class="award-meta"><span class="award-name">'+d.name+'</span><span class="award-date">'+a.date+'</span></div><h3>'+d.heading+' <small>'+d.venue+'</small></h3><p class="award-work">'+d.work+(d.korean?'<span class="original-title" lang="ko">'+d.korean+'</span>':'')+(d.context?'<span>'+d.context+'</span>':'')+'</p><p class="award-who">'+d.who+'</p><p class="award-by">'+d.by+'</p></div></div>'};});
})();
