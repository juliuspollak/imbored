--
-- PostgreSQL database dump
--

\restrict nLOebvvsbdj2EAWFimdcCkEG8B4mDBkbmE7OpSQ4XHn629tbLEMzubc4v5LQn6e

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: game_config; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.game_config VALUES ('hive', true, true, 0, 5, 1, 'solid', '{7,7,7,7,7,7,7}', '{4,6,8,10,12,14,16}', '{0,1,2,3,5,6,7}', '{0,0,0,0,0,0,0}', '{0,0,0,0,0,1,1}', true) ON CONFLICT DO NOTHING;
INSERT INTO public.game_config VALUES ('gridly', true, true, 2, 5, 1, 'rainbow', '{7,7,7,7,7,7,7}', '{6,7,9,21,12,14,16}', '{0,1,2,3,5,6,7}', '{0,0,0,0,0,0,0}', '{0,0,0,0,0,1,1}', true) ON CONFLICT DO NOTHING;
INSERT INTO public.game_config VALUES ('pinpoint', false, false, 4, 0, 0, 'solid', '{7,7,7,7,7,7,7}', '{4,6,8,10,12,14,16}', '{0,1,2,3,5,6,7}', '{0,0,0,0,0,0,0}', '{0,0,0,0,0,1,1}', false) ON CONFLICT DO NOTHING;
INSERT INTO public.game_config VALUES ('crossclimb', false, false, 5, 0, 0, 'solid', '{7,7,7,7,7,7,7}', '{4,6,8,10,12,14,16}', '{0,1,2,3,5,6,7}', '{0,0,0,0,0,0,0}', '{0,0,0,0,0,1,1}', false) ON CONFLICT DO NOTHING;
INSERT INTO public.game_config VALUES ('patches', false, false, 6, 0, 0, 'solid', '{7,7,7,7,7,7,7}', '{4,6,8,10,12,14,16}', '{0,1,2,3,5,6,7}', '{0,0,0,0,0,0,0}', '{0,0,0,0,0,1,1}', false) ON CONFLICT DO NOTHING;
INSERT INTO public.game_config VALUES ('wend', false, false, 7, 0, 0, 'solid', '{7,7,7,7,7,7,7}', '{4,6,8,10,12,14,16}', '{0,1,2,3,5,6,7}', '{0,0,0,0,0,0,0}', '{0,0,0,0,0,1,1}', false) ON CONFLICT DO NOTHING;
INSERT INTO public.game_config VALUES ('minisudoku', true, true, 3, 5, 1, 'solid', '{7,7,7,7,7,7,7}', '{4,6,8,10,12,14,16}', '{0,1,2,3,5,6,7}', '{0,0,0,0,0,0,0}', '{0,0,0,0,0,1,1}', true) ON CONFLICT DO NOTHING;
INSERT INTO public.game_config VALUES ('tango', true, true, 1, 5, 1, 'solid', '{7,7,7,7,7,7,7}', '{4,6,8,10,12,14,16}', '{0,1,2,3,5,6,7}', '{0,0,0,0,0,0,0}', '{0,0,0,0,0,1,1}', true) ON CONFLICT DO NOTHING;
INSERT INTO public.game_config VALUES ('geo', true, true, 8, 5, 1, 'solid', '{7,7,7,7,7,7,7}', '{4,6,8,10,12,14,16}', '{0,1,2,3,5,6,7}', '{0,0,0,0,0,0,0}', '{0,0,0,0,0,1,1}', true) ON CONFLICT DO NOTHING;
INSERT INTO public.game_config VALUES ('zoom', true, true, 9, 0, 0, 'solid', '{7,7,7,7,7,7,7}', '{4,6,8,10,12,14,16}', '{0,1,2,3,5,6,7}', '{0,0,0,0,0,0,0}', '{0,0,0,0,0,1,1}', true) ON CONFLICT DO NOTHING;
INSERT INTO public.game_config VALUES ('animalrush', true, true, 6, 0, 0, 'solid', '{7,7,7,7,7,7,7}', '{4,6,8,10,12,14,16}', '{0,1,2,3,5,6,7}', '{0,0,0,0,0,0,0}', '{0,0,0,0,0,1,1}', false) ON CONFLICT DO NOTHING;


--
-- Data for Name: game_time_benchmarks; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.game_time_benchmarks VALUES ('tango', 6, 'challenge', 210, NULL, 0, 210, '2026-08-02 08:59:57.446979+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 6, 'challenge', 260, NULL, 0, 260, '2026-08-02 09:00:30.539938+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 6, 'challenge', 65, NULL, 0, 65, '2026-08-02 09:04:00.044933+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 6, 'challenge', 150, NULL, 0, 150, '2026-08-02 09:04:32.183747+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 6, 'practice', 210, NULL, 0, 210, '2026-08-02 09:20:40.906382+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 1, 'practice', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 1, 'practice', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 0, 'challenge', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 1, 'practice', 90, NULL, 0, 90, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 1, 'challenge', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 6, 'practice', 260, NULL, 0, 260, '2026-08-02 10:27:58.615248+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 6, 'practice', 300, NULL, 0, 300, '2026-08-02 11:22:36.42521+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 1, 'practice', 90, NULL, 0, 90, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 0, 'challenge', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 1, 'challenge', 90, NULL, 0, 90, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 0, 'practice', 35, NULL, 0, 35, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 0, 'practice', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 0, 'practice', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 0, 'practice', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 0, 'practice', 60, NULL, 0, 60, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 0, 'challenge', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 1, 'challenge', 90, NULL, 0, 90, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 0, 'challenge', 35, NULL, 0, 35, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 0, 'challenge', 45, NULL, 0, 45, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 0, 'challenge', 60, NULL, 0, 60, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 1, 'challenge', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 0, 'practice', 45, NULL, 0, 45, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 4, 'challenge', 160, NULL, 0, 160, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 3, 'practice', 90, NULL, 0, 90, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 3, 'challenge', 120, NULL, 0, 120, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 6, 'practice', 65, NULL, 0, 65, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 3, 'practice', 50, NULL, 0, 50, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 4, 'practice', 55, NULL, 0, 55, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 2, 'challenge', 90, NULL, 0, 90, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 3, 'practice', 110, NULL, 0, 110, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 1, 'challenge', 40, NULL, 0, 40, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 5, 'practice', 60, NULL, 0, 60, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 2, 'challenge', 45, NULL, 0, 45, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 4, 'practice', 110, NULL, 0, 110, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 5, 'practice', 210, NULL, 0, 210, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 5, 'practice', 175, NULL, 0, 175, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 5, 'practice', 210, NULL, 0, 210, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 5, 'challenge', 210, NULL, 0, 210, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 4, 'practice', 145, NULL, 0, 145, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 5, 'challenge', 175, NULL, 0, 175, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 5, 'challenge', 210, NULL, 0, 210, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 2, 'practice', 100, NULL, 0, 100, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 3, 'practice', 120, NULL, 0, 120, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 2, 'challenge', 100, NULL, 0, 100, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 4, 'practice', 160, NULL, 0, 160, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 5, 'challenge', 175, NULL, 0, 175, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('hive', 6, 'challenge', 300, NULL, 0, 300, '2026-08-02 08:58:36.941648+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 6, 'challenge', 220, NULL, 0, 220, '2026-08-02 09:03:20.657879+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 6, 'practice', 220, NULL, 0, 220, '2026-08-02 10:34:20.166536+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 5, 'practice', 175, NULL, 0, 175, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 2, 'practice', 90, NULL, 0, 90, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 2, 'practice', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 5, 'practice', 130, NULL, 0, 130, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 6, 'practice', 150, NULL, 0, 150, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 2, 'practice', 110, NULL, 0, 110, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 1, 'challenge', 60, NULL, 0, 60, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 1, 'practice', 60, NULL, 0, 60, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 5, 'challenge', 60, NULL, 0, 60, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 1, 'practice', 40, NULL, 0, 40, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 4, 'challenge', 145, NULL, 0, 145, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 4, 'challenge', 165, NULL, 0, 165, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 3, 'challenge', 120, NULL, 0, 120, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 5, 'challenge', 130, NULL, 0, 130, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 3, 'practice', 135, NULL, 0, 135, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 2, 'practice', 45, NULL, 0, 45, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 2, 'practice', 105, NULL, 0, 105, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 2, 'challenge', 110, NULL, 0, 110, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 3, 'challenge', 50, NULL, 0, 50, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 3, 'challenge', 90, NULL, 0, 90, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 3, 'challenge', 135, NULL, 0, 135, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('gridly', 4, 'practice', 165, NULL, 0, 165, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 2, 'challenge', 105, NULL, 0, 105, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 3, 'challenge', 110, NULL, 0, 110, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 4, 'challenge', 110, NULL, 0, 110, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 4, 'challenge', 140, NULL, 0, 140, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('geo', 4, 'challenge', 55, NULL, 0, 55, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('zoom', 2, 'challenge', 75, NULL, 0, 75, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('tango', 3, 'practice', 120, NULL, 0, 120, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;
INSERT INTO public.game_time_benchmarks VALUES ('minisudoku', 4, 'practice', 140, NULL, 0, 140, '2026-08-02 02:42:04.667899+00') ON CONFLICT DO NOTHING;


--
-- Data for Name: points_economy_versions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.points_economy_versions VALUES ('v137-10-to-1', '2026-07-27 20:31:05.863053+00') ON CONFLICT DO NOTHING;


--
-- Data for Name: reward_rules; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.reward_rules OVERRIDING SYSTEM VALUE VALUES (1, 'Default', true, 6, 0, 0, 2, 1, 2, 1, 0, 0, 70, 2, 15, 3, 20, '2026-07-27 20:31:05.863053+00', '79bc19af-fc62-48ac-832a-faf955c6a677', 20, 50, 1, 1000000) ON CONFLICT DO NOTHING;


--
-- Name: reward_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.reward_rules_id_seq', 1, true);


--
-- PostgreSQL database dump complete
--

\unrestrict nLOebvvsbdj2EAWFimdcCkEG8B4mDBkbmE7OpSQ4XHn629tbLEMzubc4v5LQn6e

