#!/bin/bash
echo "Brisem sve: kontejnere, mreze, volumene i imageove..."
docker compose down --rmi all --volumes --remove-orphans
echo "Sistem je ociscen."