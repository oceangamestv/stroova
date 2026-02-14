# Сертификат для www.stroova.ru

Краткая инструкция: получить или расширить SSL-сертификат Let's Encrypt так, чтобы работали и **stroova.ru**, и **www.stroova.ru**.

## 1. Подключиться к серверу

```bash
ssh root@stroova.ru
```

## 2. Проверить Nginx

В конфиге сайта должны быть оба домена в `server_name`:

```bash
sudo grep server_name /etc/nginx/sites-available/stroova
```

Ожидается строка вида: `server_name stroova.ru www.stroova.ru;`  
Если там только один домен — открой конфиг и добавь второй:

```bash
sudo nano /etc/nginx/sites-available/stroova
```

В строке `server_name` через пробел укажи: `stroova.ru www.stroova.ru`. Сохрани (Ctrl+O, Enter, Ctrl+X), затем:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 3. Получить или расширить сертификат

**Если сертификата ещё нет** (первый запуск certbot):

```bash
sudo certbot --nginx -d stroova.ru -d www.stroova.ru
```

**Если сертификат уже есть только для stroova.ru** (нужно добавить www):

```bash
sudo certbot --nginx -d stroova.ru -d www.stroova.ru --expand
```

- Введи email при запросе (для напоминаний о продлении).
- Согласись с условиями (Y).
- Редирект HTTP → HTTPS выбери **2 (Redirect)**.

В конце должно быть сообщение вроде «Congratulations» — сертификат выдан для обоих имён.

## 4. Проверить

Открой в браузере:

- https://stroova.ru  
- https://www.stroova.ru  

В обоих случаях должен быть замочек (валидный HTTPS). Certbot продлевает сертификат автоматически (cron/systemd timer).
