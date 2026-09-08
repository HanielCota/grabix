import assert from "node:assert/strict";
import { test } from "node:test";
import { Semaphore } from "../../src/lib/crawl/semaphore.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("acquire resolve imediatamente até o limite max", async () => {
  const sem = new Semaphore(2);
  await sem.acquire();
  await sem.acquire();

  let thirdResolved = false;
  const third = sem.acquire().then(() => {
    thirdResolved = true;
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(thirdResolved, false);

  sem.release();
  await third;
  assert.equal(thirdResolved, true);
});

test("waiters são atendidos em ordem FIFO", async () => {
  const sem = new Semaphore(1);
  await sem.acquire();

  const order: number[] = [];
  const w1 = sem.acquire().then(() => order.push(1));
  const w2 = sem.acquire().then(() => order.push(2));
  const w3 = sem.acquire().then(() => order.push(3));

  sem.release();
  await w1;
  sem.release();
  await w2;
  sem.release();
  await w3;

  assert.deepEqual(order, [1, 2, 3]);
});

test("release transfere o slot diretamente para o próximo waiter, sem folga na contagem", async () => {
  const sem = new Semaphore(1);
  await sem.acquire();

  const waiter = deferred();
  let acquired = false;
  const pending = sem.acquire().then(() => {
    acquired = true;
  });

  // Antes do release, o waiter não pode ter resolvido
  waiter.promise.then(() => {});
  await Promise.resolve();
  assert.equal(acquired, false);

  sem.release();
  await pending;
  assert.equal(acquired, true);
  waiter.resolve();
});

test("release extra (sem acquire correspondente) nunca leva o contador a valores negativos", async () => {
  const sem = new Semaphore(1);
  await sem.acquire();
  sem.release();
  // release desbalanceado: fila vazia e contador já em 0 — deve ser ignorado
  sem.release();
  sem.release();

  // Se o contador ficasse negativo, dois acquires passariam ao mesmo tempo
  await sem.acquire();
  let secondResolved = false;
  const second = sem.acquire().then(() => {
    secondResolved = true;
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(secondResolved, false);

  sem.release();
  await second;
  assert.equal(secondResolved, true);
});

test("limita a concorrência efetiva de tarefas paralelas ao max", async () => {
  const max = 3;
  const sem = new Semaphore(max);
  let active = 0;
  let peak = 0;

  const task = async () => {
    await sem.acquire();
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    sem.release();
  };

  await Promise.all(Array.from({ length: 12 }, () => task()));
  assert.equal(peak, max);
});

test("Semaphore com max 1 serializa completamente as tarefas", async () => {
  const sem = new Semaphore(1);
  const events: string[] = [];

  const task = async (name: string) => {
    await sem.acquire();
    events.push(`start:${name}`);
    await new Promise((r) => setTimeout(r, 5));
    events.push(`end:${name}`);
    sem.release();
  };

  await Promise.all([task("a"), task("b")]);

  // Cada start deve ser imediatamente seguido pelo seu end (sem intercalação)
  assert.deepEqual(events, ["start:a", "end:a", "start:b", "end:b"]);
});
