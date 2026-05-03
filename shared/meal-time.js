window.MFC = window.MFC || {};
window.MFC.mealTime = {
  defaultMealTypeForNow() {
    const h = new Date().getHours();
    if (h < 11) return 'breakfast';
    if (h < 15) return 'lunch';
    if (h < 18) return 'snack';
    return 'dinner';
  },
};
