begin;

alter table public.time_entry_events
  drop constraint if exists time_entry_events_event_type_check;

alter table public.time_entry_events
  add constraint time_entry_events_event_type_check
  check (event_type in (
    'CLOCK_IN',
    'PAUSE_START',
    'PAUSE_END',
    'CLOCK_OUT',
    'CORRECTION_REQUESTED',
    'CORRECTION_APPROVED',
    'CORRECTION_REJECTED',
    'MANUAL_CORRECTION',
    'PROJECTION_CREATED',
    'PROJECTION_UPDATED',
    'MANAGER_DIRECT_CLOCK_IN',
    'MANAGER_DIRECT_CLOCK_OUT',
    'MANAGER_DIRECT_PAUSE_START',
    'MANAGER_DIRECT_PAUSE_END',
    'MANAGER_CHANGE_REQUESTED',
    'MANAGER_TIME_CHANGE_CONFIRMED',
    'MANAGER_TIME_CHANGE_REJECTED',
    'EMPLOYEE_TIME_CHANGE_APPROVED',
    'EMPLOYEE_TIME_CHANGE_REJECTED'
  ));

commit;
