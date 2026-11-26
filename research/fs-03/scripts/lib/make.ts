// Builds a transport by candidate name: "B", "N", "N-data", optionally "+keep_view" | "+drop_byte_at_edge" | "+duplicate_chunk".
import type { Transport } from './transport.ts';
import { Faulty, type Fault } from './harness.ts';
import { NodeNet } from '../adapters/node-net.ts';

export const makeTransport = async (spec: string, opts: { allowHalfOpen?: boolean } = {}): Promise<Transport> => {
  const [base, fault] = spec.split('+') as [string, Fault | undefined];
  let t: Transport;
  if (base === 'B') {
    const { BunConnect } = await import('../adapters/bun-connect.ts');
    t = new BunConnect(opts);
  } else if (base === 'N') t = new NodeNet('onread', opts);
  else if (base === 'N-data') t = new NodeNet('data', opts);
  else throw new Error(`unknown adapter ${spec}`);
  return fault ? new Faulty(t, fault) : t;
};
