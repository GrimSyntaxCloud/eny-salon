<?php
declare(strict_types=1);
date_default_timezone_set('America/New_York');
const SERVICES = ['Haircut'=>14.99,'Child & senior haircut'=>9.99,'Shampoo'=>5.99,'Style'=>24.99,'Bangs, neck & beard trim'=>6.99];
function e(mixed $v): string {return htmlspecialchars((string)$v, ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8');}
function db(): PDO {
 static $db;
 if ($db) return $db;
 $path=getenv('SALON_DB_PATH') ?: dirname(__DIR__).'/storage/salon.sqlite';
 if (!is_file($path)) throw new RuntimeException('Run setup.php before starting the demo.');
 $db=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
 $db->exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
 return $db;
}
function query(string $sql,array $args=[]): PDOStatement {$s=db()->prepare($sql);$s->execute($args);return $s;}
function validateCustomer(array $p): array {
 $data=[];
 foreach(['name'=>100,'email'=>200,'address'=>200,'city'=>100,'state'=>2,'zip'=>10] as $key=>$max){
  $value=trim((string)($p[$key]??''));
  if(!$value || strlen($value)>$max) throw new DomainException('Please complete all contact details within the field limits.');
  $data[$key]=$value;
 }
 if(!filter_var($data['email'],FILTER_VALIDATE_EMAIL))throw new DomainException('Please enter a valid email address.');
 if(!preg_match('/^[A-Z]{2}$/',$data['state']) || !preg_match('/^\d{5}(-\d{4})?$/',$data['zip']))throw new DomainException('Use a two-letter state and a valid US ZIP code.');
 $data['service']=(string)($p['service']??'');
 if(!isset(SERVICES[$data['service']]))throw new DomainException('Please choose a service.');
 $extras=$p['extras']??[];
 if(!is_array($extras) || array_diff($extras,['Shampoo','Style','Bangs, neck & beard trim']))throw new DomainException('Please choose valid extras.');
 $data['extras']=implode(', ',array_unique($extras));
 return $data;
}
function book(array $p): int {
 $data=validateCustomer($p);$slot=filter_var($p['slot_id']??null,FILTER_VALIDATE_INT);
 if(!$slot)throw new DomainException('Choose an available appointment.');
 $db=db();$db->beginTransaction();
 try {
  $updated=query('UPDATE slots SET available=0 WHERE id=? AND available=1 AND starts_at > ?',[$slot,date('Y-m-d H:i:s')]);
  if($updated->rowCount()!==1)throw new DomainException('That appointment is no longer available. Please choose another time.');
  query('INSERT INTO appointments(slot_id,name,email,address,city,state,zip,service,extras,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[$slot,...array_values($data),date('c')]);
  $id=(int)$db->lastInsertId();
  query('INSERT INTO outbox(recipient,subject,body,created_at) VALUES(?,?,?,?)',[$data['email'],'Your Eny appointment confirmation','Booking #'.$id.' · '.$data['service'].' · '.query('SELECT starts_at FROM slots WHERE id=?',[$slot])->fetchColumn(),date('c')]);
  $db->commit();return $id;
 } catch(Throwable $err){$db->rollBack();throw $err;}
}
function initWeb(): void {
 header("Content-Security-Policy: default-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
 header('X-Content-Type-Options: nosniff');header('Referrer-Policy: no-referrer');header('Cache-Control: no-store');
 session_name('eny_session');session_set_cookie_params(['httponly'=>true,'samesite'=>'Lax','secure'=>(!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off'),'path'=>'/']);
 $sessionDir=dirname(__DIR__).'/storage/sessions';
 if(!is_dir($sessionDir))mkdir($sessionDir,0700,true);
 session_save_path($sessionDir);ini_set('session.use_strict_mode','1');session_start();
 $_SESSION['csrf']??=bin2hex(random_bytes(32));
}
function csrf(): string{return '<input type="hidden" name="csrf" value="'.e($_SESSION['csrf']).'">';}
function requireAdmin(): void {if(empty($_SESSION['admin'])){header('Location: /?page=login',true,303);exit;}}
function redirect(string $url): never {header('Location: '.$url,true,303);exit;}
