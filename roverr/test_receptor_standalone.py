from app.logic import test_receptor_connection

# Assume receptor is running on local interface 127.0.0.1 port 8095
success, msg = test_receptor_connection("127.0.0.1", 8095)
print(success)
print(msg)
