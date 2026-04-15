CREATE TABLE IF NOT EXISTS proizvodi (
    id INT AUTO_INCREMENT PRIMARY KEY,
    naziv VARCHAR(255) NOT NULL,
    kolicina INT DEFAULT 0
);
INSERT INTO proizvodi (naziv, kolicina) VALUES ('Laptop', 10), ('Monitor', 5);