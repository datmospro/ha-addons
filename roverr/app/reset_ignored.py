from database import Movie, db

def reset_ignored():
    db.connect()
    query = Movie.update(ignored=False).where(Movie.ignored == True)
    count = query.execute()
    print(f"Reset {count} ignored movies to visible.")
    db.close()

if __name__ == "__main__":
    reset_ignored()
