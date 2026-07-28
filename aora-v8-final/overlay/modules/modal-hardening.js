"use strict";

function leaveModal(){
  const backdrop=modal(`${modalHeader("Urlaub","Antrag stellen")}<form id="leave-form" class="form-grid">
    <div class="field"><label>Von</label><input class="input" type="date" name="start" required></div>
    <div class="field"><label>Bis</label><input class="input" type="date" name="end" required></div>
    <div class="field full"><label>Art</label><select class="select" name="type"><option>Urlaub</option><option>Krankheit</option><option>Unbezahlt</option></select></div>
    <div class="field full"><label>Notiz</label><textarea class="textarea" name="note" maxlength="500"></textarea></div>
    <div class="field full actions"><button type="button" class="btn outline" data-a="close">Abbrechen</button><button class="btn" type="submit">Senden</button></div>
  </form>`);
  const form=backdrop.querySelector("form");
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const submit=form.querySelector('button[type="submit"]');
    const original=submit.textContent;
    submit.disabled=true;
    submit.textContent="Wird gesendet …";
    const request=Object.fromEntries(new FormData(form));
    try{
      await apply({type:"REQUEST_LEAVE",request});
      backdrop.remove();
      toast("Abwesenheitsantrag wurde gesendet.","success");
    }catch(error){
      toast(error?.message||"Abwesenheitsantrag konnte nicht gesendet werden.","error");
      submit.disabled=false;
      submit.textContent=original;
    }
  });
}
