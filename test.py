import urllib.request, json
url = 'https://docs.byteplus.com/en/docs/VibedStudio/1221655'
req = urllib.request.Request(url, headers={'User-Agent': 'curl'})
try:
    resp = urllib.request.urlopen(req)
    html = resp.read().decode('utf-8')
    import re
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text)
    matches = re.finditer(r'.{0,150}(\$|seedance|seedream|\d{2,4}\/1K).{0,150}', text, re.IGNORECASE)
    for m in matches:
        print(m.group(0))
except Exception as e:
    print(e)
