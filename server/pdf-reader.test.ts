import { afterEach, expect, it, vi } from "vitest";

const state=vi.hoisted(()=>({workers:[] as any[]}));
vi.mock("node:worker_threads",async()=>{
  const {EventEmitter}=await import("node:events");
  return {Worker:class extends EventEmitter {
    terminated=false;
    constructor(public url:URL,public options:unknown){super();state.workers.push(this);}
    async terminate(){this.terminated=true;this.removeAllListeners();return 0;}
  }};
});
const {readPdfPages}=await import("./services/pdf-reader.js");
const buffer=Buffer.from("%PDF-test");
afterEach(()=>vi.useRealTimers());
async function workerAt(index:number){await vi.waitFor(()=>expect(state.workers.length).toBeGreaterThan(index));return state.workers[index];}

it("bounds parser concurrency and the number of retained uploads while preserving FIFO results",async()=>{
  const start=state.workers.length;
  const first=readPdfPages(buffer),second=readPdfPages(buffer),third=readPdfPages(buffer);
  await expect(readPdfPages(buffer)).rejects.toMatchObject({status:503});
  const w1=await workerAt(start);
  expect(state.workers).toHaveLength(start+1);
  w1.emit("message",{pages:[{name:"Primero",matrix:[["A"]]}]});
  await expect(first).resolves.toEqual([{name:"Primero",matrix:[["A"]]}]);
  const w2=await workerAt(start+1);expect(w1.terminated).toBe(true);
  w2.emit("message",{pages:[{name:"Segundo",matrix:[["B"]]}]});
  await expect(second).resolves.toEqual([{name:"Segundo",matrix:[["B"]]}]);
  const w3=await workerAt(start+2);expect(w2.terminated).toBe(true);
  w3.emit("message",{pages:[]});await third;expect(w3.terminated).toBe(true);
});

it("releases failed readers before starting the next upload, including unexpected clean exits",async()=>{
  const start=state.workers.length;
  const failed=readPdfPages(buffer),queued=readPdfPages(buffer);
  const rejected=expect(failed).rejects.toMatchObject({status:400});
  const w1=await workerAt(start);w1.emit("error",new Error("Synthetic parser error"));await rejected;
  const w2=await workerAt(start+1);expect(w1.terminated).toBe(true);
  const exited=expect(queued).rejects.toMatchObject({status:400});w2.emit("exit",0);await exited;
  expect(w2.terminated).toBe(true);
});

it("terminates timed-out readers and accepts a new upload afterward",async()=>{
  vi.useFakeTimers();
  const start=state.workers.length,slow=readPdfPages(buffer);
  const rejected=expect(slow).rejects.toMatchObject({status:408});
  await vi.advanceTimersByTimeAsync(15000);await rejected;
  expect(state.workers[start].terminated).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  const next=readPdfPages(buffer);
  await vi.advanceTimersByTimeAsync(0);
  state.workers[start+1].emit("message",{pages:[]});await next;
  expect(vi.getTimerCount()).toBe(0);
});
