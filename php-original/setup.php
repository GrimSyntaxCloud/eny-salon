<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
$path=getenv('SALON_DB_PATH') ?: __DIR__.'/storage/salon.sqlite';
$password=getenv('SALON_ADMIN_PASSWORD');
if(!$password || strlen($password)<12)exit("Set SALON_ADMIN_PASSWORD to a password of at least 12 characters.\n");
if(is_file($path))exit("Database exists; refusing to overwrite it. Use another SALON_DB_PATH.\n");
$db=new PDO('sqlite:'.$path);$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
$db->exec("CREATE TABLE admins(id INTEGER PRIMARY KEY, password_hash TEXT NOT NULL);
CREATE TABLE slots(id INTEGER PRIMARY KEY, starts_at TEXT NOT NULL UNIQUE, available INTEGER NOT NULL DEFAULT 1);
CREATE TABLE appointments(id INTEGER PRIMARY KEY,slot_id INTEGER NOT NULL UNIQUE REFERENCES slots(id),name TEXT NOT NULL,email TEXT NOT NULL,address TEXT NOT NULL,city TEXT NOT NULL,state TEXT NOT NULL,zip TEXT NOT NULL,service TEXT NOT NULL,extras TEXT NOT NULL,created_at TEXT NOT NULL,is_seed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE outbox(id INTEGER PRIMARY KEY,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE messages(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE attempts(ip_hash TEXT PRIMARY KEY,failures INTEGER NOT NULL,last_at INTEGER NOT NULL);");
$db->prepare('INSERT INTO admins(password_hash) VALUES(?)')->execute([password_hash($password,PASSWORD_DEFAULT)]);
date_default_timezone_set('America/New_York');
$s=$db->prepare('INSERT INTO slots(starts_at) VALUES(?)');
for($day=1;$day<=14;$day++){
 $date=new DateTimeImmutable('+'.$day.' days');if($date->format('N')==='7')continue;
 foreach(['09:00:00','11:00:00','14:00:00','16:00:00'] as $time)$s->execute([$date->format('Y-m-d').' '.$time]);
}
$db->exec("UPDATE slots SET available=0 WHERE id=1");
$db->prepare('INSERT INTO appointments(slot_id,name,email,address,city,state,zip,service,extras,created_at,is_seed) VALUES(?,?,?,?,?,?,?,?,?,?,1)')->execute([1,'Alex Rowan','alex@example.test','100 Demo Lane','Sample City','IL','60000','Haircut','Shampoo',date('c')]);
chmod($path,0600);echo "Created fictional salon demo database.\n";
