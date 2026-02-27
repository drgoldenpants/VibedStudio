import urllib.request, json
req = urllib.request.Request(
    'https://byteplus.com/api/pricing/calculator/data?lang=en&region=ap-southeast-1',
    headers={'User-Agent': 'Mozilla/5.0'}
)
# need to disable SSL verification because of potential curl certificate issues
import ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

try:
    resp = urllib.request.urlopen(req, context=ctx)
    data = json.loads(resp.read().decode('utf-8'))
    for item in data:
       if "vibedstudio" in item.get('serviceName', '').lower():
           print(json.dumps(item))
except Exception as e:
    print(e)
