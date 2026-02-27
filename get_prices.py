import urllib.request, json, re

req = urllib.request.Request(
    'https://docs.byteplus.com/api/docs/doc/get',
    data=json.dumps({"ID": 1390292, "Language": "en"}).encode(),
    headers={
        'Content-Type': 'application/json',
        'User-Agent': 'curl/7.81.0'
    }
)

try:
    resp = urllib.request.urlopen(req)
    r = resp.read().decode('utf-8')
    d = json.loads(r)
    content = d.get("Result", {}).get("Content", "")
    with open("pricing.md", "w") as f:
        f.write(content)
    print("wrote to pricing.md")
except Exception as e:
    print("error", e)
