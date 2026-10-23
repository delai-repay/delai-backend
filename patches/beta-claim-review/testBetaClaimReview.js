import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import { buildSubmissionSnapshotHash } from "../src/operators/submissionSnapshot.js";
import { createClaimFinalReviewHandlers, FINAL_SUBMISSION_ACKNOWLEDGEMENT } from "../src/operators/claimFinalReview.js";
import { approveClaimFinalSubmission, revokeClaimFinalSubmissionApproval, consumeClaimFinalSubmissionApproval } from "../src/operators/submissionApprovalService.js";
import { requireClaimId } from "../src/security/httpSecurity.js";

const CLAIM="11111111-1111-4111-8111-111111111111", OWNER="22222222-2222-4222-8222-222222222222", OTHER="33333333-3333-4333-8333-333333333333", DELAY="44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-10-23T12:00:00Z");
// Match production source consistently on Windows (CRLF) and Linux (LF).
const source = (await readFile(new URL("../src/server.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const authSource = source.slice(source.indexOf("async function requireAuthenticatedUser("), source.indexOf("function requireAutomationSecret("));
const routeSource = source.slice(source.indexOf("const reviewedClaimHandlers = createClaimFinalReviewHandlers("), source.indexOf('app.post("/mark-claim-submitted"'));
assert.ok(authSource && routeSource, "Current server route wiring must be present");

function newFixture() {
  return {
    enabled: false, writes: [], rpcs: [], queued: [], queueError: false, rpcError: false,
    rows: {
      claims: [{ id: CLAIM, user_id: OWNER, detected_delay_id: DELAY, status: "ready_to_submit", claim_type: "delay_repay", submission_status: "awaiting_operator_integration", submission_source: "greater_anglia_playwright_executor_safety_locked", submitted_at: null, operator_reference: null }],
      detected_delays: [{ id: DELAY, user_id: OWNER, operator: "Greater Anglia", passenger_confirmation_status: "confirmed", service_date: "2026-10-07", scheduled_departure_time:"18:42" }],
      claim_submission_approvals: [],
    },
    context: {
      contextVersion: "1.4-cancellations", generatedAt: NOW.toISOString(),
      claim: { id: CLAIM, userId: OWNER, detectedDelayId: DELAY, status: "ready_to_submit", submissionStatus: "awaiting_operator_integration", claimType: "delay_repay" },
      operator: { key: "greater_anglia", displayName: "Greater Anglia" },
      passenger: { title: "Ms", fullName: "Test Passenger", email: "test@example.test", addressLine1: "11 Test Road", townCity: "London", postcode: "SW1A 1AA", country: "United Kingdom" },
      journey: { date: "2026-10-07", scheduledTime: "18:42", originStation: "Origin", destinationStation: "Destination", delayMinutes: 15 },
      ticket: { id: "ticket-a", type: "Annual Season", cost: 5620, startDate: "2026-01-01", endDate: "2026-12-31", smartcardNumber: "123456789012345678" },
      paymentDetails: { preferredPaymentMethod: "BACS", bankAccountName: "Test Passenger", sortCode: "123456", accountNumber: "12345678" },
    },
  };
}
let f;
class Query {
  constructor(table) { this.table=table; this.filters=[]; this.fields="*"; this.change=null; }
  select(fields) { this.fields=fields; return this; }
  eq(key,value) { this.filters.push([key,value]); return this; }
  is(key,value) { return this.eq(key,value); }
  update(values) { this.change=values; return this; }
  then(resolve,reject) { return this.maybeSingle().then(resolve,reject); }
  async maybeSingle() {
    const row=f.rows[this.table].find((r)=>this.filters.every(([k,v])=>r[k]===v));
    if (!row) return {data:null,error:null};
    if(this.change) { Object.assign(row,this.change); f.writes.push({table:this.table,values:{...this.change},filters:this.filters}); }
    const data=this.fields==="*"?structuredClone(row):Object.fromEntries(this.fields.split(",").map((k)=>[k,row[k]]));
    return {data,error:null};
  }
}
const supabase = {
  auth: {getUser:async(token)=>({ data:{user:token==="owner-token"?{id:OWNER}:token==="other-token"?{id:OTHER}:null}, error:null })},
  from: (table)=>new Query(table),
  async rpc(name,args) {
    f.rpcs.push({name,args});
    if(f.rpcError) return {data:null,error:new Error("fixture RPC error")};
    if(name==="approve_claim_final_submission" && f.rpcWait) await f.rpcWait;
    let row=f.rows.claim_submission_approvals.find((r)=>r.claim_id===args.p_claim_id && r.user_id===args.p_user_id);
    if(name==="approve_claim_final_submission") {
      row={claim_id:args.p_claim_id,user_id:args.p_user_id,status:"approved",submission_hash:args.p_submission_hash,approved_at:NOW.toISOString(),expires_at:new Date(NOW.getTime()+900000).toISOString(),generation:1};
      f.rows.claim_submission_approvals=[row];
    } else if(name==="revoke_claim_final_submission_approval") {
      if(row?.status!=="approved") return {data:[],error:null};
      row.status="revoked";
    } else if(name==="consume_claim_final_submission_approval") {
      if(row?.status!=="approved" || row.submission_hash!==args.p_submission_hash || row.expires_at<=NOW.toISOString()) return {data:[],error:null};
      row.status="consumed";
    }
    return {data:row?[structuredClone(row)]:[],error:null};
  },
};
const app=express(); app.use(express.json());
const requireAuthenticatedUser=new Function("supabaseAdmin", authSource+"\nreturn requireAuthenticatedUser;")(supabase);
const args={
  app,
  createClaimFinalReviewHandlers:(d)=>createClaimFinalReviewHandlers({...d,now:()=>NOW}),
  FINAL_SUBMISSION_ACKNOWLEDGEMENT,
  supabaseAdmin:supabase,
  withTimeout:async(query)=>await query,
  loadClaimSubmissionContext:async({claim,detectedDelay})=>{
    if(f.contextError) throw f.contextError;
    assert.ok(detectedDelay.service_date || detectedDelay.delay_date, "The full journey row must reach context loading");
    const context=structuredClone(f.context);
    context.generatedAt=new Date().toISOString();
    context.claim.submissionStatus=claim.submission_status;
    return context;
  },
  validateSubmissionContext:()=>({readyForSubmission:f.valid!==false}),
  isGreaterAngliaFinalSubmitEnabled:()=>f.enabled,
  approveClaimFinalSubmission,
  revokeClaimFinalSubmissionApproval,
  queueAutomationJob:async(job)=>{ if(f.queueError) throw new Error("fixture queue error"); f.queued.push(job); return {id:"fixture-job"}; },
  requireAuthenticatedUser,
  claimMutationRateLimiter:(_req,_res,next)=>next(),
  requireClaimId,
};
new Function(...Object.keys(args),routeSource)(...Object.values(args));
// Execute the production worker through approval consumption, stopping before
// its first operator call. All database, clock and queue dependencies are fake.
const workerStart=source.indexOf("async function processClaimSubmitJob(job)");
const workerEnd=source.indexOf("  try {\n    submissionResult = await submitClaimThroughOperatorAdapter",workerStart);
assert.ok(workerStart>0 && workerEnd>workerStart);
const workerArgs={...args,consumeClaimFinalSubmissionApproval,buildSubmissionSnapshotHash,
  isCancelledService:()=>false,evaluateAndPersistGreaterAngliaDeadline:async()=>({eligible:true}),
  normaliseExactServiceTime:value=>value,isGreaterAngliaName:value=>String(value).toLowerCase().replace(/[^a-z]/g,"")==="greateranglia"};
const worker=new Function(...Object.keys(workerArgs),source.slice(workerStart,workerEnd)+"return finalSubmitAuthorization;\n}\nreturn processClaimSubmitJob;")(...Object.values(workerArgs));
const server=await new Promise((resolve)=>{ const s=app.listen(0,"127.0.0.1",()=>resolve(s)); });
const base=`http://127.0.0.1:${server.address().port}`;
async function post(path,body={claim_id:CLAIM},token="owner-token") {
  const response=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  return {status:response.status,headers:response.headers,body:await response.json()};
}
const preview=()=>post("/claim-final-submit-review");
const approve=(hash,extra={})=>post("/approve-claim-final-submit",{claim_id:CLAIM,review_hash:hash,confirm_final_submission:true,approval_acknowledgement:FINAL_SUBMISSION_ACKNOWLEDGEMENT,...extra});
let count=0;
const expectedLogs=[];
const originalError=console.error;
console.error=(...args)=>{
  if(args[0]==="Claim final review failed:") expectedLogs.push(args);
  else originalError(...args);
};
async function test(name,run) { f=newFixture(); try{await run();count++;}catch(error){error.message=`${name}: ${error.message}`;throw error;} }
try {
  await test("disabled-mode preview is owner-scoped and read-only",async()=>{
    const r=await preview(); assert.equal(r.status,200); assert.equal(r.headers.get("cache-control"),"no-store");
    assert.equal(r.body.workflow.can_approve,false); assert.equal(r.body.workflow.global_pilot_lock_enabled,true);
    assert.equal(r.body.review.passenger.address[0],"11 Test Road"); assert.equal(r.body.review.journey.scheduled_time,"18:42");
    assert.equal(r.body.review.fee_percentage,10); assert.equal(r.body.review.payout.account_last4,"5678");
    assert.deepEqual(f.writes,[]); assert.deepEqual(f.rpcs,[]); assert.deepEqual(f.queued,[]);
  });
  await test("preview never exposes raw bank/smartcard fields or the full context",async()=>{
    const r=await preview(); const text=JSON.stringify(r.body);
    for(const secret of ["123456789012345678",'"accountNumber"','"sortCode"','"bankAccountName"','"submissionContext"']) assert.equal(text.includes(secret),false);
  });
  await test("anonymous calls fail on all three real server routes",async()=>{
    for(const path of ["/claim-final-submit-review","/approve-claim-final-submit","/revoke-claim-final-submit"]) assert.equal((await post(path,{claim_id:CLAIM},null)).status,401);
    assert.equal(f.writes.length,0);
  });
  await test("a different owner cannot read or approve the claim",async()=>{
    assert.equal((await post("/claim-final-submit-review",{claim_id:CLAIM},"other-token")).status,404);
    f.enabled=true;
    assert.equal((await post("/approve-claim-final-submit",{claim_id:CLAIM,review_hash:"a".repeat(64),confirm_final_submission:true,approval_acknowledgement:FINAL_SUBMISSION_ACKNOWLEDGEMENT},"other-token")).status,404);
    assert.equal(f.writes.length,0);
  });
  await test("forged user IDs are rejected by the production authentication middleware",async()=>{
    assert.equal((await post("/claim-final-submit-review",{claim_id:CLAIM,user_id:OTHER})).status,403);
  });
  await test("the global lock blocks approval without recording or queuing it",async()=>{
    const r=await approve((await preview()).body.review.review_hash); assert.equal(r.status,409);
    assert.equal(r.body.code,"final_submission_paused"); assert.equal(f.writes.length,0); assert.equal(f.rpcs.length,0); assert.equal(f.queued.length,0);
  });
  await test("an unchecked/missing acknowledgement cannot approve",async()=>{
    f.enabled=true; assert.equal((await approve("a".repeat(64),{confirm_final_submission:false})).status,400);
    assert.equal((await approve("a".repeat(64),{approval_acknowledgement:"yes"})).status,400); assert.equal(f.writes.length,0);
  });
  await test("a fresh review fingerprint is required",async()=>{
    f.enabled=true; assert.equal((await approve(null)).status,400); assert.equal(f.writes.length,0);
  });
  await test("the journey date is loaded and an expired claim stays blocked",async()=>{
    f.rows.detected_delays[0].service_date="2026-08-01";
    assert.equal((await preview()).body.code,"claim_deadline_expired"); assert.equal(f.writes.length,0);
  });
  await test("unconfirmed travel, cancellation routes and incomplete details stay blocked",async()=>{
    f.rows.detected_delays[0].passenger_confirmation_status="pending"; assert.equal((await preview()).status,409);
    f.rows.detected_delays[0].passenger_confirmation_status="confirmed"; f.rows.claims[0].claim_type="cancellation_compensation"; assert.equal((await preview()).status,409);
    f.rows.claims[0].claim_type="delay_repay"; f.rows.detected_delays[0].service_status="cancelled"; assert.equal((await preview()).body.code,"unsupported_claim_type");
    f.rows.detected_delays[0].service_status="delayed"; f.valid=false; assert.equal((await preview()).body.code,"claim_details_incomplete");
    assert.equal(f.writes.length,0);
  });
  await test("sent evidence prevents repeat approval",async()=>{
    f.enabled=true; f.rows.claims[0].operator_reference="TEST-REF";
    const state=(await preview()).body.workflow;
    assert.equal(state.submitted,false); assert.equal(state.submission_uncertain,true);
    assert.equal((await approve("a".repeat(64))).status,409); assert.equal(f.writes.length,0);
  });
  await test("changed address, ticket and payout details invalidate the review",async()=>{
    for(const [section,key,value] of [["passenger","addressLine1","12 Test Road"],["ticket","cost",6000],["paymentDetails","accountNumber","87654321"]]) {
      f=newFixture(); f.enabled=true; const hash=(await preview()).body.review.review_hash;
      f.context[section][key]=value; const r=await approve(hash);
      assert.equal(r.body.code,"review_changed"); assert.equal(f.writes.length,0); assert.equal(f.queued.length,0);
    }
  });
  await test("generated timestamps and workflow transitions do not change the hash",()=>{
    const c=structuredClone(f.context), claim=f.rows.claims[0], detectedDelay=f.rows.detected_delays[0];
    const before=buildSubmissionSnapshotHash({claim,detectedDelay,submissionContext:c});
    c.generatedAt="2026-10-23T12:15:00Z"; c.claim.submissionStatus="approved_for_submission";
    const reversed=Object.fromEntries(Object.entries(c).reverse());
    assert.equal(buildSubmissionSnapshotHash({claim,detectedDelay,submissionContext:reversed}),before);
    c.journey.scheduledTime="18:43"; assert.notEqual(buildSubmissionSnapshotHash({claim,detectedDelay,submissionContext:c}),before);
  });
  await test("approval and later worker consumption use the same stable snapshot",async()=>{
    f.enabled=true; const hash=(await preview()).body.review.review_hash;
    const result=await approve(hash); assert.equal(result.status,200); assert.equal(result.body.submitted,false); assert.equal(f.queued.length,1);
    const consumed=await worker({id:"job-a",claim_id:CLAIM,user_id:OWNER});
    assert.equal(consumed.authorized,true);
    assert.equal((await consumeClaimFinalSubmissionApproval({supabase,userId:OWNER,claimId:CLAIM,jobId:"job-b",submissionHash:hash})).authorized,false);
  });
  await test("concurrent approval requests reserve and queue only once",async()=>{
    f.enabled=true; const hash=(await preview()).body.review.review_hash;
    const results=await Promise.all([approve(hash),approve(hash)]);
    assert.deepEqual(results.map((r)=>r.status).sort(),[200,409]); assert.equal(f.queued.length,1);
    assert.equal(f.rpcs.filter((r)=>r.name==="approve_claim_final_submission").length,1);
  });
  await test("an uncertain approval failure remains held and cannot be blindly retried",async()=>{
    f.enabled=true; const hash=(await preview()).body.review.review_hash; f.rpcError=true;
    assert.equal((await approve(hash)).status,503); assert.equal(f.rows.claims[0].submission_status,"approved_for_submission");
    assert.equal((await approve(hash)).status,409); assert.equal(f.queued.length,0);
  });
  await test("an uncertain queue failure keeps one approval and blocks reapproval",async()=>{
    f.enabled=true; const hash=(await preview()).body.review.review_hash; f.queueError=true;
    assert.equal((await approve(hash)).status,503); assert.equal((await approve(hash)).status,409);
    assert.equal(f.rpcs.filter((r)=>r.name==="approve_claim_final_submission").length,1);
  });
  await test("the owner can cancel an approval before consumption",async()=>{
    f.enabled=true; await approve((await preview()).body.review.review_hash);
    const r=await post("/revoke-claim-final-submit"); assert.equal(r.status,200);
    assert.equal(f.rows.claim_submission_approvals[0].status,"revoked"); assert.equal(f.rows.claims[0].submission_status,"awaiting_operator_integration");
  });
  await test("consumed approvals cannot be reset by cancellation",async()=>{
    f.enabled=true; await approve((await preview()).body.review.review_hash); f.rows.claim_submission_approvals[0].status="consumed";
    const writes=f.writes.length; assert.equal((await post("/revoke-claim-final-submit")).status,409); assert.equal(f.writes.length,writes);
  });
  await test("an incomplete reservation stays held instead of racing an in-flight RPC",async()=>{
    f.rows.claims[0].submission_status="approved_for_submission";
    assert.equal((await post("/revoke-claim-final-submit")).body.code,"approval_state_uncertain");
    assert.equal((await preview()).body.workflow.can_revoke,false); assert.equal(f.writes.length,0);
  });
  await test("an approval RPC still in flight cannot be cancelled or replaced",async()=>{
    f.enabled=true;
    f.rows.claim_submission_approvals=[{claim_id:CLAIM,user_id:OWNER,status:"revoked",expires_at:NOW.toISOString(),generation:1}];
    const hash=(await preview()).body.review.review_hash;
    let finish; f.rpcWait=new Promise(resolve=>{finish=resolve;});
    const request=approve(hash);
    while(!f.rpcs.length) await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal((await preview()).body.workflow.can_revoke,false);
    assert.equal((await post("/revoke-claim-final-submit")).status,409);
    assert.equal((await approve(hash)).status,409);finish();assert.equal((await request).status,200);
    assert.equal(f.queued.length,1);
  });
  await test("an old unused approval must be revoked before a new approval",async()=>{
    f.enabled=true; await approve((await preview()).body.review.review_hash);
    f.rows.claims[0].submission_status="awaiting_operator_integration";
    const state=(await preview()).body;assert.equal(state.workflow.can_approve,false);assert.equal(state.workflow.can_revoke,true);
    assert.equal((await approve(state.review.review_hash)).body.code,"approval_already_recorded");
    assert.equal((await post("/revoke-claim-final-submit")).status,200);
    assert.equal((await preview()).body.workflow.can_approve,true);
  });
  await test("the global lock prevents the production worker from consuming approval",async()=>{
    const result=await worker({id:"job-a",claim_id:CLAIM,user_id:OWNER});
    assert.equal(result.authorized,false);assert.equal(f.rpcs.length,0);
  });
  await test("expired and incomplete pending approvals can still be inspected and cancelled",async()=>{
    f.enabled=true; await approve((await preview()).body.review.review_hash);
    f.rows.claim_submission_approvals[0].expires_at="2026-10-23T11:00:00Z";
    f.rows.detected_delays[0].service_date="2026-08-01"; f.valid=false;
    const result=await preview();
    assert.equal(result.status,200); assert.equal(result.body.claim_id,CLAIM); assert.equal(result.body.review,null);
    assert.equal(result.body.workflow.approval_status,"expired"); assert.equal(result.body.workflow.can_revoke,true);
    assert.equal((await post("/revoke-claim-final-submit")).status,200);
    assert.equal((await preview()).body.code,"claim_deadline_expired");
  });
  await test("service errors cannot leak bank data through an HTTP status property",async()=>{
    f.contextError=Object.assign(new Error("private bank detail fixture"),{status:400,code:"fixture_private_error"});
    const r=await preview();assert.equal(r.status,503);assert.equal(r.body.code,"review_service_unavailable");assert.doesNotMatch(JSON.stringify(r.body),/private bank/);
  });
  assert.equal(expectedLogs.length,3,"Only the intentionally failed service fixtures should log service errors");
  console.log(`Beta claim review: ${count} checks passed. No operator or real database was contacted.`);
} finally { console.error=originalError; server.closeAllConnections(); await new Promise((resolve)=>server.close(resolve)); }
