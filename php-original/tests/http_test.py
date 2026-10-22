import urllib.request, urllib.parse, http.cookiejar, re, sqlite3
BASE='http://127.0.0.1:4340'
cookies=http.cookiejar.CookieJar(); opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
def get(path):
 r=opener.open(BASE+path);return r.status,r.read().decode()
def post(path,values):
 try:
  r=opener.open(BASE+path,urllib.parse.urlencode(values,doseq=True).encode());return r.status,r.read().decode()
 except urllib.error.HTTPError as e:return e.code,e.read().decode()
def token(html):return re.search(r'name="csrf" value="([a-f0-9]+)"',html)[1]
status,html=get('/?page=book');assert status==200
csrf=token(html);slot=re.search(r'<option value="(\d+)"',html)[1]
data=dict(csrf=csrf,action='book',slot_id=slot,name="O'Neil <script>alert(1)</script>",email='guest@example.test',address='1 Sample Lane',city='Sample City',state='IL',zip='60000',service='Haircut',**{'extras[]':['Shampoo']})
assert post('/?page=book',{**data,'csrf':'wrong'})[0]==403
assert post('/?page=book',{**data,'email':'bad'})[0]==422
status,confirmation=post('/?page=book',data);assert status==200 and 'You’re booked.' in confirmation and '&lt;script&gt;' in confirmation
assert post('/?page=book',data)[0]==422
assert 'The salon' in get('/?page=admin')[1]
assert post('/?page=login',dict(csrf=csrf,action='login',password='bad'))[0]==422
status,html=post('/?page=login',dict(csrf=csrf,action='login',password='LocalSalonDemo2026!'));assert status==200 and 'Today,' in html
assert '&lt;script&gt;' in html and '<script>alert' not in html
edit=re.findall(r'page=edit&id=(\d+)',html)[-1]
status,html=get('/?page=edit&id='+edit);assert status==200
csrf=token(html);newslot=re.findall(r'<option value="(\d+)"',html)[-1]
status,html=post('/?page=edit&id='+edit,{**data,'csrf':csrf,'action':'edit','id':edit,'slot_id':newslot,'name':'Jamie Demo'});assert status==200 and 'Jamie Demo' in html
status,html=post('/?page=contact',dict(csrf=csrf,action='contact',name='Guest Demo',email='hello@example.test',message='A fictional message'));assert status==200 and 'No email was sent.' in html
assert 'A fictional message' in get('/?page=inbox')[1]
status,html=get('/?page=availability');csrf=token(html)
# A reserved slot cannot be reopened through availability toggle.
post('/?page=availability',dict(csrf=csrf,action='availability',slot_id=newslot))
assert f'<option value="{newslot}"' not in get('/?page=book')[1]
post('/',dict(csrf=csrf,action='logout'));assert 'The salon' in get('/?page=admin')[1]
print('PASS: booking; validation; CSRF; output escaping; duplicate prevention; login; access control; appointment edit/reschedule; contact/outbox; reserved slot protection; logout')
