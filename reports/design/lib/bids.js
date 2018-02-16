var jsp = require('./jsonpatch');
var bids_disclojure_date;
var startDate;
var id;
var tender_start_date;
var tenderID;
var is_multilot;
var type;
// Date of new algorithm
var new_date = '2017-08-16T00:00:01+03:00';
var thresholdDate = '2017-01-01T00:00:01+03:00';
var emitter = {
    lot: function(owner, date, bid, lot, tender, audits, init_date, date_terminated, state, results) {
        results.push({
            key: [owner, date, bid.id, lot.id, state],
            value: {
                tender: id,
                lot: lot.id,
                value: lot.value.amount,
                currency: lot.value.currency,
                bid: bid.id,
                startdate: startDate,
                audits: audits,
                tender_start_date: tender_start_date,
                tenderID: tenderID,
                initialDate: init_date,
                lot_status: lot.status,
                tender_status: tender.status,
                date_terminated: date_terminated,
                state: state,
            }
        });
    },
    tender: function(owner, date, bid, tender, audits, init_date, date_terminated, state, results) {
        results.push({
            key: [owner, date, bid.id, state], 
            value: {
                tender: id,
                value: tender.value.amount,
                currency: tender.value.currency,
                bid: bid.id,
                audits: audits,
                startdate: startDate,
                tender_start_date: tender_start_date,
                tenderID: tenderID,
                initialDate: init_date,
                status: tender.status,
                date_terminated: date_terminated,
                state: state,
            }
        });
    }
};

function get_eu_tender_bids(tender) {
    var qualified_bids = (tender.qualifications || []).map(function(qualification) {
        return qualification.bidID;
    });
    return (tender.bids || []).filter(function(bid) {
        return (qualified_bids.indexOf(bid.id) !== -1);
    });
}

function find_matched_revs(revisions, pattern) {
    return revisions.filter(function(rev) {
        var changes = rev.changes.filter(function(change) {
           return (change.path.indexOf(pattern) !== -1);
        });
        return (changes.length !== 0);
    });
}

function find_initial_bid_date(revisions, bid_index) {
    var revs = find_matched_revs(revisions, '/bids/' + bid_index);
    if (typeof revs === 'undefined' || revs.length === 0) {
        revs = find_matched_revs(revisions, '/bids');
    }
    if (typeof revs === 'undefined' || revs.length === 0) {
        return '';
    }
    return revs[0].date || '';
}

function filter_bids(bids) {
    var min_date = Date.parse("2017-01-01T00:00:00+03:00");
    return bids.filter(function(bid) {
        var bid_date = Date.parse(bid.date);
        return ((["active", "invalid.pre-qualification"].indexOf(bid.status) !== -1) &&
         (+bid_date > +min_date));
    });
}

function find_first_revision_date(doc) {
    if ((typeof doc.revisions === 'undefined') || (doc.revisions.length === 0)) {
        return '';
    }
    return doc.revisions[0].date || '';
}

function date_normalize(date) {
    return ((typeof date !== 'object') ? (new Date(date)) : date).toISOString().slice(0, 23);
}

function get_bids(tender) {
    switch (tender.procurementMethodType) {
        case 'aboveThresholdEU':
        case 'competitiveDialogueEU':
        case 'competitiveDialogueUA':
            return get_eu_tender_bids(tender);
        default:
            return filter_bids(tender.bids || []);
    }
}

function count_lot_bids(lot, tender) {
    var bids = get_bids(tender);
    return bids.map(function(bid) {
        return ( bid.lotValues || [] ).filter(function(value) {
            return value.relatedLot === lot.id;
        }).length;
    }).reduce(function( total, curr) {
        return total + curr;
    }, 0);
}

function count_lot_qualifications(qualifications, lot) {
    if ((typeof qualifications === 'undefined') || (qualifications.length === 0)) {
        return 0;
    }
    if (lot.status !== "cancelled") {
        return qualifications.filter(function(qualification) {
            return (qualification.lotID === lot.id) &&
                ((qualification.status || "active") !== "cancelled");
        }).length;
    } else {
        return qualifications.filter(function(qualification) {
            return (qualification.lotID === lot.id) && (qualification.status || "");
        }).length;
    }
}

function check_bids_from_bt_atu(tender, lot) {
    var type = tender.procurementMethodType;
    if (type === 'aboveThresholdUA') {
        var bids_n = 0;
        if ('lots' in tender) {
            bids_n = count_lot_bids(lot, tender);
        } else {
            bids_n = tender.numberOfBids || 0;
        }
        return bids_n >= 2;
    } else if (['belowThreshold', 'aboveThresholdUA.defense'].indexOf(type) !== -1) {
        return true;
    } else {
        return false;
    }
}

function check_tender_bids(tender) {
    var type = tender.procurementMethodType;
    switch (type) {
        case 'aboveThresholdEU':
            return ((tender.qualifications || []).length >= 2);
        case 'competitiveDialogueEU':
        case 'competitiveDialogueUA':
            return ((tender.qualifications || []).length >= 3);
        default:
            if ('awards' in tender) {
                return true;
            } else {
                return check_bids_from_bt_atu(tender, "");
            }
    }
}

function check_lot_bids(tender, lot) {
    var type = tender.procurementMethodType;
    switch (type) {
        case 'aboveThresholdEU':
            return (count_lot_qualifications(tender.qualifications, lot) >= 2);
        case 'competitiveDialogueEU':
        case 'competitiveDialogueUA':
            return (count_lot_qualifications(tender.qualifications, lot) >= 3);
        default: // belowThreshold && aboveThresholdUA && aboveThresholdUA.defense
            var lot_awards = (tender.awards || []).filter(function(award) {
                return (award.lotID || "") === lot.id;
            });
            if (lot_awards.length > 0) {
                return true;
            } else {
                return check_bids_from_bt_atu(tender, lot);
            }
    }
}

function check_tender(tender) {
    switch(tender.status) {
    case "cancelled":
        var bids_disclojure_date = (tender.qualificationPeriod || {}).startDate || (tender.awardPeriod || {}).startDate || null;
        if ((new Date(tender.date)) < (new Date(bids_disclojure_date))) {
            return false;
        }
        return check_tender_bids(tender);
    case "unsuccessful":
        return check_tender_bids(tender);
    default:
        return true;
    }
}

function check_lot(tender, lot) {
    switch (lot.status) {
        case "cancelled":
            var bids_disclojure_date = (tender.qualificationPeriod || {}).startDate || (tender.awardPeriod || {}).startDate || null;
            if ((new Date(lot.date)) < (new Date(bids_disclojure_date))) {
                return false;
            }
            return check_lot_bids(tender, lot);
        case "unsuccessful":
            return check_lot_bids(tender, lot);
        default:
            return true;
    }
}

function get_audit(tender, pattern) {
    var audits = (tender.documents || []).filter(function(tender_doc) {
        return tender_doc.title.indexOf(pattern) !== -1;
    });
    var audit = '';
    if (audits.length > 1) {
        audit = audits.reduce(function(prev_doc, curr_doc) {
            return (prev_doc.dateModified > curr_doc.dateModified) ? curr_doc : prev_doc;
        });
    } else {
        audit = audits[0] || null;
    }
    return audit;
}

function find_lot_for_bid(tender, lotValue) {
    var lot = '';
    var lots = (tender.lots || []).filter(function(lot) {
        return lot.id === lotValue.relatedLot;
    });
    if (lots.length > 0) {
        return lots[0];
    } else {
        return false
    };
}

function check_award_for_bid(tender, bid) {
    var checker = false;
    var is_awarded = false;
    (tender.awards || []).forEach(function(award) {
        if (award.bid_id === bid.id) {
            is_awarded = true;
            if (['active', 'pending'].indexOf(award.status) !== -1) {
                checker = true;
            }
        }
    });
    return ((checker) || (!is_awarded));
}

function check_award_for_bid_multilot(tender, bid, lot) {
    var checker = false;
    var is_awarded = false;
    (tender.awards || []).forEach(function(award) {
        if ((award.bid_id === bid.id) && (award.lotID === lot.id)) {
            is_awarded = true;
            if (['active', 'pending'].indexOf(award.status) !== -1) {
                checker = true;
            }
        }
    });
    // this check is unnecessary
    if ((!checker) && !('awards' in tender)) {
        checker = check_bids_from_bt_atu(tender, lot);
    }
    return ((checker) || (!is_awarded));
}

function check_qualification_for_bid(tender, bid, lot) {
    var checker = false;
    (tender.qualifications || []).forEach(function(qualification) {
        if ((qualification.bidID === bid.id) && (lot ? qualification.lotID === lot.id : true)) {
            if (qualification.status === 'active') {
                checker = true;
            }
        }
    });
    return checker;
}

function get_month(date) {
    return (new Date(date)).getMonth();
}

function get_info_about_cancelled_lot(actual_tender, old_tender, bid, lot) {
    var checker = false;
    if (old_tender.status === 'active.pre-qualification') {
        old_tender.qualifications.forEach(function(qual) {
            if ((qual.bidID === bid.id) && (qual.lotID === lot.id) && (qual.status !== 'cancelled')) {
                checker = true;
            }
        });
    } else if (old_tender.status === 'active.pre-qualification.stand-still') {
        old_tender.qualifications.forEach(function(qual) {
            if ((qual.bidID === bid.id) && (qual.lotID === lot.id) && (qual.status === 'active')) {
                checker = true;
            }
        });
    } else {
        if ("awards" in old_tender) {
            return (check_qualification_for_bid(actual_tender, bid, lot) && check_award_for_bid_multilot(actual_tender, bid, lot));
        }
        else {
            return check_qualification_for_bid(actual_tender, bid, lot);
        }
    }
    return checker;
}


function check_qualification_for_EU_bid(tender, bid, lot) {
    var checker = false;
    if (lot) {
        if (lot.status === 'unsuccessful') {
            return (check_qualification_for_bid(tender, bid, lot) && check_award_for_bid_multilot(tender, bid, lot));
        } else {
            var revs = tender.revisions.slice().reverse().slice(0, tender.revisions.length - 1);
            var tender_copy = JSON.parse(JSON.stringify(tender));
            for (var i = 0; i < revs.length; i ++) {
                tender_copy = jsp.apply(tender_copy, revs[i].changes);
                var found = tender_copy.lots.filter(function(l) {
                    return ((l.status !== 'cancelled') && (l.id === lot.id));
                });
                if (found.length > 0) {
                    break;
                }
                return get_info_about_cancelled_lot(tender, tender_copy, bid, lot);
            }
        }
    } else {
        if (tender.status === 'unsuccessful') {
            return check_qualification_for_bid(tender, bid);
        } else {
            var revs = tender.revisions.slice().reverse().slice(0, tender.revisions.length - 1)
            var tender_copy = JSON.parse(JSON.stringify(tender));
            var prev = jsp.apply(tender_copy, revs[0].changes);
            if (prev.status == 'active.pre-qualification') {
                prev.qualifications.forEach(function(qual) {
                    if (qual.status !== 'cancelled') {
                        checker = true;
                    }
                });
            } else if (prev.status == 'active.pre-qualification.stand-still') {
                prev.qualifications.forEach(function(qual) {
                    if (qual.status === 'active') {
                        checker = true;
                    }
                });
            } else {
                if ('awards' in prev) {
                    return (check_award_for_bid(tender, bid) && check_qualification_for_bid(tender, bid));
                } else {
                    return check_qualification_for_bid(tender, bid);
                }
            }
        }
    }
    return checker;
}

function check_award_and_qualification(tender, bid, lot) {
    var type = tender.procurementMethodType;
    if (['aboveThresholdEU', 'competitiveDialogueEU', 'competitiveDialogueUA'].indexOf(type) !== -1) {
        return check_qualification_for_EU_bid(tender, bid, lot);
    } else {
    if (lot) {
        return check_award_for_bid_multilot(tender, bid, lot);
    } else {
            return check_award_for_bid(tender, bid);
        }
    }
}

function check_bid(actual_bids, old_bid) {
    checker = actual_bids.filter(function (bid) {
        return (bid.id === old_bid.id);
    });
    return (checker.length > 0);
}

function check_if_lot_not_cancelled(old_tender, cancelled_lots_ids) {
    non_cancelled_lots = old_tender.lots.filter(function (lot) {
        return ((cancelled_lots_ids.indexOf(lot.id) !== -1) && (lot.status !== 'cancelled'));
    });
    if (non_cancelled_lots.length > 0) {
        return non_cancelled_lots;
    } else {
        return false;
    }
}

function find_actual_lot(tender, lot_id) {
    return tender.lots.filter(function (lot) {
        return lot.id === lot_id;
    });
}

function emit_deleted_lotValues(tender, actual_bids, results) {
    cancelled_lots_ids = tender.cancellations.filter(function(cancellation) {
        return ((cancellation.cancellationOf === 'lot') && (cancellation.status === 'active'));
    }).map(function (lot) {
            return lot.relatedLot;
        });
    if (cancelled_lots_ids.length > 0) {
        var revs = tender.revisions.slice().reverse().slice(0, tender.revisions.length - 1);
        var tender_copy = JSON.parse(JSON.stringify(tender));
        for (var i = 0; i < revs.length; i++) {
            if (cancelled_lots_ids.length === 0) { return; }
            try {
                tender_copy = jsp.apply(tender_copy, revs[i].changes);
            }
            catch (e) {
                log(e)
            }
            var non_cancelled_lots = check_if_lot_not_cancelled(tender_copy, cancelled_lots_ids);
            if (non_cancelled_lots) {
                non_cancelled_lots.forEach(function(old_lot) {
                    var id = old_lot.id;
                    (tender_copy.bids || []).forEach(function (old_bid) {
                        if (check_bid(actual_bids, old_bid)) {
                            old_bid.lotValues.forEach(function (lotValue) {
                                if (lotValue.relatedLot === old_lot.id) {
                                    if (get_info_about_cancelled_lot(tender, tender_copy, old_bid, old_lot)) {
                                        var actual_lot = find_actual_lot(tender, old_lot.id)[0];
                                        var audit = get_audit(tender, "audit_" + tender.id + "_" + actual_lot.id);
                                        var init_date = find_initial_bid_date(tender.revisions || [], tender_copy.bids.indexOf(old_bid), old_bid.id);
                                        var date_terminated = date_normalize(actual_lot.date);
                                        var state = (get_month(bids_disclojure_date) !== get_month(date_terminated)) ? 3 : 2;
                                        emitter.lot(old_bid.owner, date_normalize(bids_disclojure_date), old_bid, actual_lot, tender, audit, init_date, false, 1, results);
                                        emitter.lot(old_bid.owner, date_normalize(date_terminated), old_bid, actual_lot, tender, audit, init_date, date_normalize(date_terminated), state, results);
                                    } else {
                                        actual_lot = find_actual_lot(tender, old_lot.id)[0];
                                        var audit = get_audit(tender, "audit_" + tender.id + "_" + actual_lot.id);
                                        var init_date = find_initial_bid_date(tender.revisions || [], tender_copy.bids.indexOf(old_bid), old_bid.id);
                                        emitter.lot(old_bid.owner, date_normalize(bids_disclojure_date), old_bid, actual_lot, tender, audit, init_date, false, 1, results);
                                        emitter.lot(old_bid.owner, date_normalize(bids_disclojure_date), old_bid, actual_lot, tender, audit, init_date, false, 4, results);
                                    }
                                }
                            });
                        }
                    });
                    cancelled_lots_ids = cancelled_lots_ids.filter(function (id_) {
                        return id_ !== id;
                    });
                });
            }
        }
    }
}

function emit_results(tender, results) {
    var bids = get_bids(tender);
    if((tender.status === 'cancelled') && (tender.date <  bids_disclojure_date)) {
        return;
    }
    if (bids) {
        if (startDate > new_date) {
            if (('cancellations' in tender) && (['aboveThresholdEU', 'competitiveDialogueEU'].indexOf(tender.procurementMethodType) !== -1)) {
                emit_deleted_lotValues(tender, bids, results);
            }
            bids.forEach(function(bid) {
                if (is_multilot) {
                    (bid.lotValues || []).forEach(function(lotValue) {
                        var lot = find_lot_for_bid(tender, lotValue);
                if (!lot) {
                    return;
                }
                if ((lot.status === 'cancelled') && (lot.date < bids_disclojure_date)) {
                    return;
                }
                if (check_lot_bids(tender, lot)) {
                    var audit = get_audit(tender, "audit_" + tender.id + "_" + lot.id);
                    var init_date = find_initial_bid_date(tender.revisions || [], tender.bids.indexOf(bid));
                    if ((['unsuccessful', 'cancelled'].indexOf(lot.status) !== -1) && (check_award_and_qualification(tender, bid, lot))) {
                        var date_terminated = date_normalize(lot.date);
                        var state = (get_month(bids_disclojure_date) !== get_month(date_terminated)) ? 3: 2;
                        if (state === 2) {
                            emitter.lot(bid.owner, date_normalize(bids_disclojure_date), bid, lot, tender, audit, init_date, false, 1, results);
                        }
                        emitter.lot(bid.owner, date_normalize(date_terminated), bid, lot, tender, audit, init_date, date_normalize(date_terminated), state, results);
                    } else if ((['unsuccessful', 'cancelled'].indexOf(tender.status) !== -1) && (check_award_and_qualification(tender, bid, lot))) {
                        var date_terminated = date_normalize(tender.date);
                        var state = (get_month(bids_disclojure_date) !== get_month(date_terminated)) ? 3: 2;
                        if (state === 2) {
                            emitter.lot(bid.owner, date_normalize(bids_disclojure_date), bid, lot, tender, audit, init_date, false, 1, results);
                        }
                        emitter.lot(bid.owner, date_normalize(date_terminated), bid, lot, tender, audit, init_date, date_normalize(date_terminated), state, results);
                    } else {
                        emitter.lot(bid.owner, date_normalize(bids_disclojure_date), bid, lot, tender, audit, init_date, false, 1, results);
                        emitter.lot(bid.owner, date_normalize(bids_disclojure_date), bid, lot, tender, audit, init_date, false, 4, results);
                    }
                }
                      });
                } else { // is multilot end
                    if (check_tender_bids(tender, bid)) {
                        var audits = get_audit(tender, "audit");
                        var init_date = find_initial_bid_date(tender.revisions || [], tender.bids.indexOf(bid));
                        if ((['unsuccessful', 'cancelled'].indexOf(tender.status) !== -1) && (check_award_and_qualification(tender, bid, ""))) {
                            var date_terminated = date_normalize(tender.date);
                            var state = (get_month(bids_disclojure_date) === get_month(date_terminated)) ? 2 : 3;
                            if (state === 2) {
                                emitter.tender(bid.owner, date_normalize(bids_disclojure_date), bid, tender, audits, init_date, false, 1, results);
                            }
                            emitter.tender(bid.owner, date_normalize(date_terminated), bid, tender, audits, init_date, date_normalize(date_terminated), state, results);
                        } else {
                            emitter.tender(bid.owner, date_normalize(bids_disclojure_date), bid, tender, audits, init_date, false, 1, results);
                            emitter.tender(bid.owner, date_normalize(bids_disclojure_date), bid, tender, audits, init_date, false, 4, results);
                        }
                    }
                }
            });
        } else {
            if(is_multilot) {
                (bids || []).forEach(function(bid) {
                    var init_date = find_initial_bid_date(tender.revisions || [], tender.bids.indexOf(bid));
                    (bid.lotValues || []).forEach(function(value) {
                        tender.lots.forEach(function(lot) {
                            if (check_lot(tender, lot)) {
                                if (value.relatedLot === lot.id) {
                                    var audit = get_audit(tender, "audit_" + tender.id + "_" + lot.id);
                                    emitter.lot(bid.owner, date_normalize(bids_disclojure_date), bid, lot, tender, audit, init_date, false, false, results);
                                }
                            }
                        });
                    });
                });
            } else {
                if (!(check_tender(tender))) { return; }
                var audit = get_audit(tender, "audit");
                (bids || []).forEach(function(bid) {
                    var init_date = find_initial_bid_date(tender.revisions, tender.bids.indexOf(bid));
                    emitter.tender(bid.owner, date_normalize(bids_disclojure_date), bid, tender, audit, init_date, false, false, results);
                });
            }
        }
    }
}

function main(doc) {
    if (doc.doc_type !== "Tender") {
        return [];
    }
    
    if ((doc.mode || "") === "test") {
        return [];
    }

    if (doc.procurementMethodType === 'esco') { return []; }

    startDate = (doc.enquiryPeriod||{}).startDate;
    if (!startDate) {
        startDate = find_first_revision_date(doc);
    }

    if (doc.procurementMethod !== "open") {return;}

    bids_disclojure_date = (doc.qualificationPeriod || {}).startDate || (doc.awardPeriod || {}).startDate || null;
    if(!bids_disclojure_date) {
        return [];
    }
    // payments should be calculated only from first stage of CD and only once
    if ((doc.procurementMethod !== "open") && (['competitiveDialogueEU', 'competitiveDialogueUA'].indexOf(doc.procurementMethodType) === -1)) {
        return [];
    }

    if ((['selective', 'open'].indexOf(doc.procurementMethod) === -1) && (['competitiveDialogueEU', 'competitiveDialogueUA'].indexOf(doc.procurementMethodType) !== -1)) {
        return [];
    }

    id = doc._id;
    tender_start_date = doc.tenderPeriod.startDate;
    tenderID = doc.tenderID;
    is_multilot = ("lots" in doc) ? true : false;
    type = doc.procurementMethodType;

    var results = [];
    emit_results(doc, results);
    return results;
}

exports.main = main;
exports.get_eu_tender_bids = get_eu_tender_bids;
exports.find_matched_revs = find_matched_revs;
exports.find_initial_bid_date = find_initial_bid_date;
exports.filter_bids = filter_bids;
exports.find_first_revision_date = find_first_revision_date;
exports.date_normalize = date_normalize;
exports.get_bids = get_bids;
exports.count_lot_bids = count_lot_bids;
exports.count_lot_qualifications = count_lot_qualifications;
exports.check_bids_from_bt_atu = check_bids_from_bt_atu;
exports.check_tender_bids = check_tender_bids;
exports.check_lot_bids = check_lot_bids;
exports.check_tender = check_tender;
exports.check_lot = check_lot;
exports.get_audit = get_audit;
exports.find_lot_for_bid = find_lot_for_bid;
exports.check_award_and_qualification = check_award_and_qualification;
exports.check_award_for_bid = check_award_for_bid;
exports.check_award_for_bid_multilot = check_award_for_bid_multilot;
exports.check_qualification_for_bid = check_qualification_for_bid;
exports.check_qualification_for_EU_bid = check_qualification_for_EU_bid;
exports.emit_deleted_lotValues = emit_deleted_lotValues;
exports.get_info_about_cancelled_lot = get_info_about_cancelled_lot;
