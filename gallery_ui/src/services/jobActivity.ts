export const JOB_ACTIVITY_EVENT = "universal-gallery:job-activity";

export const reportJobActivity = (delta: number) => {
  window.dispatchEvent(new CustomEvent(JOB_ACTIVITY_EVENT, { detail: delta }));
};
