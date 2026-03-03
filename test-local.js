import fetch from 'node-fetch';

async function test() {
  const url = "https://fddh5jm5vi.execute-api.us-east-1.amazonaws.com/Prod/api/v2/prism/chat";
  const body = {"userId":"test","message":"hi","mode":"ask"};
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  console.log(res.status);
  console.log(await res.text());
}
test();
