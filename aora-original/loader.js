(()=>{
  "use strict";
  const base="https://xqgkawskftzurbujrpex.supabase.co/functions/v1/aora-assets/";
  const css=document.createElement("link");
  css.rel="stylesheet";
  css.href=base+"styles.css";
  css.integrity="sha384-gWdWRgwpyF963RtOVMpvZAwgnl4fVkirxEJQgNHnFrfY0Xq2x1HQRlHBOvIEB3Cs";
  css.crossOrigin="anonymous";
  document.head.append(css);
  const assets=[
    ["utils.js","sha384-eWos+bB1mLqZ9F4nLsEEc+2Q9kQSJi9Qhqtr4jC8Gi8PrKkptoUX5HBpNKbA0Tas"],
    ["config.js","sha384-DJ7rl48Wa8RAa9KofKeii9CcbUSIy67PXpQXe8sYuZUPdUrYHI3Ov7AjHaLodelC"],
    ["logo.js","sha384-VLFx/PjTWypHH53eEgEAPCyt/uBmwnqV5ieK+HMw3aTnh4+Voz7NKt5p3em/oJs4"],
    ["icons.js","sha384-yEpUHP+NqqF/zy40s7c48pjUV2E+G+i7tvTiiiWrKCKW6ays6OWidrMqcI1J8BSL"],
    ["api.js","sha384-b3wwdmoBvbAuncL++qAhR3SR/y3v63/L/k1pIP4Cz91XP1daF/M7bNWJPjM/nWVQ"],
    ["access.js","sha384-CbHFbD7cvpsPHKPrpE6YXar7NgmZD4v6iH+b+fGg7Tsm2Z1OIw/woajM2jZpx0LB"],
    ["employee.js","sha384-oWlzNnh0oyUcle1KpsopTKYiEHDLumbOoBmXNcXK+2EIVKo7gIakLanWpNF2s8h6"],
    ["admin.js","sha384-UBVLSU2SwnmVdDUN3E/8WPjeBjESeoLKIMLWz41FfVNhMno/nkWZ6qYwrAwHWvt1"],
    ["kiosk-helpers.js","sha384-50vpuCeMrxaTnHZjjw/1jWkJ6s/KyuBEf0gmg9g0dntriSonq29iM5e0bHgevxaF"],
    ["kiosk-view.js","sha384-vJ9GcYMCflOspubnH4ZIc3FR4HYSxpR/qQ45jxW0tRkHE6XZv/16qzbLlX4kBtUF"],
    ["modals.js","sha384-kPCHqTw5Yy2PbWD4JtILzP56wE6xCMi0QKfcHCRd29uWKYhYRZUkSfhC2E7QqjSi"],
    ["handlers.js","sha384-zafdslVZG1qJNu9ml6uDudGyGEcz3F5ApLc9HH5l4We6SBSpmkvvV6nvkQd14QCm"],
    ["boot.js","sha384-xyGGgBV+Sz3gehjmjT1FbtZss63Gk3MYpYgjvKZbAO7CIeYytGileUdpfZ8RYi3N"]
  ];
  let chain=Promise.resolve();
  for(const [file,integrity] of assets){
    chain=chain.then(()=>new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src=base+file;
      script.integrity=integrity;
      script.crossOrigin="anonymous";
      script.onload=resolve;
      script.onerror=reject;
      document.body.append(script);
    }));
  }
  chain.catch(()=>{
    const target=document.getElementById("app");
    if(target)target.innerHTML='<main style="font-family:Arial,sans-serif;padding:32px"><h1>AoraAI konnte nicht geladen werden.</h1><p>Bitte die Seite neu laden.</p></main>';
  });
})();
