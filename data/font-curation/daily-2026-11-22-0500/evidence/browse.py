# coding:utf-8
import pathlib,subprocess,json,time
p=pathlib.Path('/tmp/font-daily-1122')
for label,url in [('zcool','https://www.zcool.com.cn/search/content?word=%E5%AD%97%E4%BD%93%E8%AE%BE%E8%AE%A1'),('ziticq','https://www.ziticq.com/')]+[(i,'https://www.uisdc.com/group/'+i+'.html') for i in ['644226','643550','601339','608768','576955','576731','629164','624305','620145','619796','617008','574294','636653','690343','689366']]:
 p.joinpath('navigate.js').write_text('location.href='+json.dumps(url)+";'navigation-requested'")
 subprocess.run([str(p/'chrome-tab'),'7792','1465085013','1465085100',str(p/'navigate.js')],capture_output=True,check=True)
 for a in range(4):
  time.sleep(.5);o=subprocess.run([str(p/'chrome-tab'),'7792','1465085013','1465085100',str(p/'read.js')],capture_output=True,text=True,check=True)
  try:d=json.loads(o.stdout)
  except:continue
  if d['url']==url and len(d['body'])>200:break
 p.joinpath('browser-'+label+'.json').write_text(o.stdout);print(label,d['title'],flush=True)
