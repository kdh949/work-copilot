import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';

export default new DataSource(createDatabaseOptions());
