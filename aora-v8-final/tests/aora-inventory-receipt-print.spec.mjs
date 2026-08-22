import {test,expect} from "@playwright/test";

const workspace=process.env.AORA_WORKSPACE_SLUG;
const env=name=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};

function inventoryRequest(request,action){
  return request.method()==="POST"&&request.url().includes("/functions/v1/aora-v8-inventory-next")&&String(request.postData()||"").includes(`\"action\":\"${action}\"`);
}

async function loginOwner(page){
  await page.goto(`/inhaber/?workspace=${encodeURIComponent(workspace)}&inventory=1`);
  await page.locator('input[name="email"]').fill(env("AORA_OWNER_EMAIL"));
  await page.locator('input[name="password"]').fill(env("AORA_OWNER_PASSWORD"));
  const response=page.waitForResponse(r=>r.status()===200&&r.request().url().includes("/functions/v1/aora-v8-pilot-access")&&String(r.request().postData()||"").includes('"action":"passwordLogin"'));
  await page.locator('#password-login button[type="submit"]').click();
  await response;
  await expect(page.locator(".admin-app")).toBeVisible({timeout:30000});
}

async function openWorkspaceSection(page,section){
  await page.evaluate(async section=>{
    S.inventorySection=section;S.adminView="inventory";S.inventoryMenuOpen=true;inventoryWorkspaceInvalidate();renderAdmin();await loadInventoryWorkspace(section,true);renderAdmin();
  },section);
  await expect(page.locator(".inventory-workspace")).toBeVisible({timeout:30000});
}

test("Receipt creates an exact deferred QR job and confirms only after printing",async({page})=>{
  const diagnostics=[];
  page.on("pageerror",error=>diagnostics.push(`page:${error.message}`));
  page.on("console",message=>{if(message.type()==="error")diagnostics.push(`console:${message.text()}`)});
  page.on("requestfailed",request=>diagnostics.push(`network:${request.failure()?.errorText||"failed"}:${new URL(request.url()).pathname}`));
  await loginOwner(page);

  const seeded=await page.evaluate(async()=>{
    const suffix=crypto.randomUUID().slice(0,8),locationId=S.locationId;
    const supplier=await invRequest("upsertSupplier",{locationId,name:`CI QR Supplier ${suffix}`,email:"ci-qr@example.com",whatsapp:"+4915112345678",orderingMethod:"BOTH"});
    const product=await invRequest("createProductBundle",{locationId,name:`CI QR Product ${suffix}`,sku:`CI-QR-${suffix}`,barcode:"",baseUom:"piece",category:"CI QR",reorderPoint:0,packCode:`CIQR-${suffix}`,packLabel:"Stück",baseQuantity:1,isStockUnit:true,isOrderUnit:true,supplierId:supplier.id,supplierSku:`SUP-${suffix}`,unitPrice:1,currency:"EUR",minimumOrderQuantity:1,orderMultiple:1,idempotencyKey:crypto.randomUUID()});
    const mapped=await invRequest("listSupplierItems",{locationId,supplierId:supplier.id});
    const supplierItem=(mapped.items||[]).find(item=>String(item.item_id)===String(product.itemId));
    if(!supplierItem)throw new Error("Seeded supplier item was not returned");
    const order=await invRequest("createPurchaseOrder",{locationId,supplierId:supplier.id,lines:[{supplierItemId:supplierItem.id,packCount:6}],note:"Isolated browser receipt-print test",idempotencyKey:crypto.randomUUID()});
    const delivery=await invRequest("sendPurchaseOrder",{purchaseOrderId:order.purchaseOrderId,channel:"whatsapp"});
    if(delivery.status==="manual_required")await invRequest("confirmManualPurchaseOrderSent",{purchaseOrderId:order.purchaseOrderId,deliveryId:delivery.deliveryId});
    return{locationId,itemId:product.itemId,orderId:order.purchaseOrderId,orderNumber:order.orderNumber,productName:`CI QR Product ${suffix}`};
  });

  await openWorkspaceSection(page,"orders");
  const orderCard=page.locator(".inventory-workspace-order").filter({hasText:seeded.orderNumber}).first();
  await expect(orderCard).toBeVisible();
  await expect(orderCard).toContainText("Bestellt");
  await orderCard.getByRole("button",{name:"Ware angekommen"}).click();
  const receipt=page.locator("#receive-delivery-form");
  await expect(receipt).toBeVisible();
  await expect(receipt.locator("[data-good-count]")).toHaveText("6");
  const receiptResponse=page.waitForResponse(r=>r.status()===200&&inventoryRequest(r.request(),"receivePurchaseOrderDelivery"));
  await receipt.getByRole("button",{name:"Alles wie bestellt annehmen"}).click();
  const receiptBody=await (await receiptResponse).json();
  expect(receiptBody.printJobIds).toHaveLength(1);
  expect(receiptBody.purchaseOrderStatus).toBe("received");

  const choice=page.locator(".inventory-receipt-print-choice");
  await expect(choice.getByRole("button",{name:"Jetzt drucken"})).toBeVisible();
  await expect(choice.getByRole("button",{name:"Später drucken"})).toBeVisible();
  await choice.getByRole("button",{name:"Später drucken"}).click();
  await expect(choice).toBeHidden();

  await page.reload();
  await expect(page.locator(".admin-app")).toBeVisible({timeout:30000});
  await openWorkspaceSection(page,"qr");
  const job=page.locator(".inventory-workspace-qr-job").filter({hasText:seeded.productName}).first();
  await expect(job).toContainText("6 Etiketten");
  await job.getByRole("button").click();
  const qrDialog=page.locator(".modal-backdrop .modal").last();
  await expect(qrDialog).toContainText("6 QR-Etiketten bereit");
  expect(await qrDialog.locator(".inventory-qr-preview .inventory-card").count()).toBe(6);

  await page.evaluate(()=>{window.__aoraPrintHtml="";window.open=()=>({document:{open(){},write(value){window.__aoraPrintHtml+=String(value)},close(){}}})});
  await qrDialog.getByRole("button",{name:"Drucken / PDF"}).click();
  await expect(qrDialog.getByText("Erfolgreich gedruckt?",{exact:true})).toBeVisible();
  const printEvidence=await page.evaluate(()=>({labels:(window.__aoraPrintHtml.match(/class=\"label\"/g)||[]).length,hasPrint:window.__aoraPrintHtml.includes("window.print()"),size:window.__aoraPrintHtml.length}));
  expect(printEvidence).toMatchObject({labels:6,hasPrint:true});
  expect(printEvidence.size).toBeGreaterThan(500);

  await qrDialog.getByRole("button",{name:"Noch nicht"}).click();
  await expect(qrDialog).toBeHidden();
  const stillQueued=await page.evaluate(async({locationId,jobId})=>{const jobs=await invRequest("listPrintJobs",{locationId});return jobs.jobs.find(job=>job.id===jobId)}, {locationId:seeded.locationId,jobId:receiptBody.printJobIds[0]});
  expect(stillQueued).toMatchObject({labelCount:6,status:"prepared"});

  await openWorkspaceSection(page,"qr");
  await page.locator(".inventory-workspace-qr-job").filter({hasText:seeded.productName}).getByRole("button").click();
  page.once("dialog",dialog=>dialog.accept());
  const reopened=page.locator(".modal-backdrop .modal").last();
  await expect(reopened).toContainText("6 QR-Etiketten bereit");
  await reopened.getByRole("button",{name:"Drucken / PDF"}).click();
  const confirmResponse=page.waitForResponse(r=>r.status()===200&&inventoryRequest(r.request(),"confirmPrintJob"));
  await reopened.getByRole("button",{name:"Ja, erfolgreich"}).click();
  await confirmResponse;
  await expect(reopened).toBeHidden();

  const persisted=await page.evaluate(async({locationId,itemId,jobId,orderId})=>{
    const[jobs,stock,orders]=await Promise.all([invRequest("listPrintJobs",{locationId}),invRequest("listStock",{locationId}),invRequest("listPurchaseOrders",{locationId})]);
    return{jobOpen:jobs.jobs.some(job=>job.id===jobId),onHand:stock.items.find(item=>String(item.itemId||item.id)===String(itemId))?.onHand,orderStatus:orders.orders.find(order=>order.id===orderId)?.status};
  },{locationId:seeded.locationId,itemId:seeded.itemId,jobId:receiptBody.printJobIds[0],orderId:seeded.orderId});
  expect(persisted).toEqual({jobOpen:false,onHand:6,orderStatus:"received"});
  expect(diagnostics).toEqual([]);
});
