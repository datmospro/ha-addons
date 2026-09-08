import requests
import threading
from .config import logger, load_settings

def send_telegram_notification(message):
    """
    Sends a notification to the configured Telegram chat.
    """
    try:
        settings = load_settings()
        token = settings.get('telegram_bot_token')
        chat_id = settings.get('telegram_chat_id')
        
        if not token or not chat_id:
            return False
            
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "HTML"
        }
        
        # Run in a separate thread to avoid blocking
        def _send():
            try:
                requests.post(url, json=payload, timeout=10)
            except Exception as e:
                logger.error(f"Error sending Telegram notification: {e}")
                
        threading.Thread(target=_send).start()
        return True
    except Exception as e:
        logger.error(f"Error initiating Telegram notification: {e}")
        return False

def test_telegram_connection(token, chat_id):
    """
    Tests Telegram connection by sending a test message.
    """
    try:
        if not token or not chat_id:
            return False, "Missing Token or Chat ID"
            
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": "🔔 <b>Roverr Test Message</b>\n\nIf you are reading this, your Telegram configuration is correct!",
            "parse_mode": "HTML"
        }
        
        res = requests.post(url, json=payload, timeout=10)
        data = res.json()
        
        if res.status_code == 200 and data.get('ok'):
            return True, "Test message sent successfully!"
        else:
            return False, f"Telegram API Error: {data.get('description', 'Unknown error')}"
            
    except Exception as e:
        return False, f"Connection Error: {str(e)}"

