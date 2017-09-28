function(doc) {
    var jsp = require('views/lib/jsonpatch');
    if (doc.doc_type !== "Tender") {return;}
    if ((doc.mode || "") === "test") {return;}
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

    function find_initial_bid_date(revisions, bid_index, bid_id) {
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
        var min_date =  Date.parse("2017-01-01T00:00:00+03:00");
        return bids.filter(function(bid) {
            var bid_date =  Date.parse(bid.date);
            return (((bid.status || "invalid") === "active") &&
		     (+bid_date > +min_date));
        });
    }

    function find_first_revision_date(doc) {
        if ((typeof doc.revisions === 'undefined') || (doc.revisions.length === 0)) {
            return '';
        }
        return doc.revisions[0].date || '';
    }

    var startDate = (doc.enquiryPeriod||{}).startDate;
    if (!startDate) {
        startDate = find_first_revision_date(doc);
    }

    if (doc.procurementMethod !== "open") {return;}

    var bids_disclojure_date = (doc.qualificationPeriod || {}).startDate || (doc.awardPeriod || {}).startDate || null;
    if(!bids_disclojure_date) { return; }
    // payments should be calculated only from first stage of CD and only once
    if ((doc.procurementMethod !== "open") && (['competitiveDialogueEU', 'competitiveDialogueUA'].indexOf(doc.procurementMethodType) === -1)) {return;}

    if ((['selective', 'open'].indexOf(doc.procurementMethod) === -1) && (['competitiveDialogueEU', 'competitiveDialogueUA'].indexOf(doc.procurementMethodType) !== -1)) {return;}


    var id = doc._id;
    var tender_start_date = doc.tenderPeriod.startDate;
    var tenderID = doc.tenderID;
    var is_multilot = ( "lots" in doc )?true:false;
    var type = doc.procurementMethodType;
    // Date of new algorithm
    var new_date = '2017-08-16T00:00:01+03:00';
    var thresholdDate = '2017-01-01T00:00:01+03:00';

    function date_normalize(date) {
	   return ((typeof date !== 'object') ? (new Date(date)) : date).toISOString().slice(0, 23);
    }

    function find_bid_by_lot(id) {
        var results = [];
        bids.forEach(function(bid) {
            bid.lotValues.forEach(function(value) {
                if ((value.relatedLot === id) && ((["invalid"].indexOf(value.status || "active") === -1))) {
                    results.push(bid);
                }
            });
        });
        return results;
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

     function count_lot_qualifications(qualifications, lot_id) {
        if ((typeof qualifications === 'undefined') || (qualifications.length === 0)) {
            return 0;
        }
	if (lot.status !== "cancelled") {
		return qualifications.filter(function(qualification) {
			return ((qualification.lotID === lot_id) &&
				((qualification.status || "active") !== "cancelled"));
		}).length;
	}
        return qualifications.filter(function(qualification) {
            return (qualification.lotID === lot_id) && ((qualification.status || ""));
        }).length;
    }

    function check_tender_bids(tender) {
        var type = tender.procurementMethodType;
        switch (type) {
            case 'aboveThresholdEU':
		return ((tender.qualifications || []).length >= 2);
            case 'competitiveDialogueEU':

		return ((tender.qualifications || []).length >= 3);
            default:
		if ('awards' in tender) {
			return true;
		} else {
			return check_bids_from_bt_atu(tender, lot);
		}
        }
    }

    function check_bids_from_bt_atu(tender, lot) {
	    if (type === 'aboveThresholdUA') {
		var bids_n = count_lot_bids(lot, tender);
		if ('lots' in tender) {
		    bids_n = count_lot_bids(lot, tender);
		} else {
		    bids_n = tender.numberOfBids || 0;
		}
		if ( bids_n < 2) {
		    return false;
		}
		return true;
	    } else if (['belowThreshold', 'aboveThresholdUA.defense'] !== -1) {
		return true;
	    } else {
		return false;
	    }
	    return false;
    }

    function check_lot_bids(tender, lot) {
        var type = tender.procurementMethodType;
        switch (type) {
            case 'aboveThresholdEU':
		return (count_lot_qualifications(tender.qualifications, lot.id) >= 2);
            case 'competitiveDialogueEU':
            case 'competitiveDialogueUA':
		return (count_lot_qualifications(tender.qualifications, lot.id) >= 3);
            default: // belowThreshold && aboveThresholdUA && aboveThresholdUA.defense
		var lot_awards = (tender.awards || []).filter(function(award) {
			return ( award.lotID || "" ) === lot.id;
		});
		if (lot_awards.length > 0) {
            		return true;
		} else {
			return check_bids_from_bt_atu(tender, lot);
		}
		return false;
        }
    }

    function check_tender(tender) {
        switch(tender.status) {
        case "cancelled":
        if ((new Date(tender.date)) < (new Date(bids_disclojure_date))) {
                return false;
        }
            if (! check_tender_bids(tender)) {
                return false;
            }
            return true;
        case "unsuccessful":
            if (! check_tender_bids(tender)) {
                return false;
            }
            return true;
        default:
            return true;
        }
    }


    function check_lot(tender, lot){
        switch (lot.status) {
        case "cancelled":
            if ((new Date(lot.date)) < (new Date(bids_disclojure_date))) {
                return false;
            }
	    if (! check_lot_bids(tender, lot)) {
                return false;
            }

            return true;
        case "unsuccessful":
            if (! check_lot_bids(tender, lot)) {
                return false;
            }
            return true;
        default:
            return true;
        }
    }


    function get_audit_for_lot(tender, lot) {
        var audits = (tender.documents || []).filter(function(tender_doc) {
            return tender_doc.title.indexOf("audit_" + tender.id + "_" + lot.id) !== -1;
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

    function get_audit_for_tender(tender) {
       var audits = (tender.documents || []).filter(function(tender_doc) {
            return tender_doc.title.match(/audit/);
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

    function find_lot_for_bid(tender, bid) {
        var lot = '';
        if ('lots' in tender) {
            (bid.lotValues || []).forEach(function(lotValue) {
                tender.lots.forEach(function(lot) {
                    if (lotValue.relatedLot === lot.id) {lot = lot;}
                });
            });
        }
        return lot;
    }

    function check_award_for_bid(tender, bid) {
	var checker = false;
        (tender.awards || []).forEach(function(award) {
            if (award.bid_id === bid.id) {
                if (award.status === 'active') {
                    checker = true;
                }
            }
        });
        return checker;
    }

    function check_award_for_bid_multilot(tender, bid, lot) {
    	var checker = false;
        (tender.awards || []).forEach(function(award) {
            if ((award.bid_id === bid.id) && (award.lotID === lot.id)) {
                if (award.status === 'active') {
                    checker = true;
                }
            }
        });
	if (!checker) {
		checker = check_bids_from_bt_atu(tender, lot);
	}
        return checker;
    }

    function check_qualification_for_bid(tender, bid, lot) {
        var checker = false;
        if (lot) {
            (tender.qualifications || []).forEach(function(qualification) {
                if ((qualification.bidID === bid.id) && (qualification.lotID === lot.id)) {
                    if (qualification.status === 'active') {
                        checker = true;
                    }
                }
            });
        } else {
            (tender.qualifications || []).forEach(function(qualification) {
                if (qualification.bidID === bid.id) {
                    if (qualification.status === 'active') {
                        checker = true;
                    }
                }
            });
        }
        return checker;
    }

    function get_month(date) {
	return (new Date(date)).getMonth();
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
                        return ((l.status !== 'cancelled') && (l.id == lot.id));
                    })
                    if (found.length > 0) {
                        break;
                    }
                }
                if (tender_copy.status === 'active.pre-qualification') {
                    tender_copy.qualifications.forEach(function(qual) {
                        if ((qual.bidID === bid.id) && (qual.lotID === lot.id) && (qual.status !== 'cancelled')) {
                            checker = true;
                        }
                    });
                } else if (tender_copy.status === 'active.pre-qualification.stand-still') {
                    tender_copy.qualifications.forEach(function(qual) {
                        if ((qual.bidID === bid.id) && (qual.lotID === lot.id) && (qual.status === 'active')) {
                            checker = true;
                        }
                    });
                } else {
                    if ("awards" in tender_copy) {
                        return (check_qualification_for_bid(tender, bid, lot) && check_award_for_bid_multilot(tender, bid, lot));
                    }
                    else {
                        check_qualification_for_bid(tender, bid, lot);
                    }
                }
            }
        } else {
            if (tender.status === 'unsuccessful') {
                return check_qualification_for_bid(tender, bid);
            } else {
                var revs = tender.revisions.slice().reverse().slice(0, tender.revisions.length - 1)
                var tender_copy = JSON.parse(JSON.stringify(tender));
                tender_copy = jsp.apply(tender_copy, revs[0].changes);
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

    var emitter = {
        lot: function(owner, date, bid, lot, tender, audits, init_date, date_terminated, state) {
            emit([owner, date, bid.id, lot.id], {
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
            });
        },
        tender: function(owner, date, bid, tender, audits, init_date, date_terminated, state){
            emit([owner, date, bid.id], {
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
            });
        }
    };

    function emit_results(tender) {
        var bids = get_bids(tender);
	if((tender.status === 'cancelled') && (tender.date <  bids_disclojure_date)) {
		return;
	}
        if (bids) {
            if (startDate > new_date) {
                bids.forEach(function(bid) {
                if (is_multilot) {
                    var lot = find_lot_for_bid(tender, bid);

		    if ((lot.status === 'cancelled') && (lot.date < bids_disclojure_date)) {
                        return;
                    }
                    if (check_lot_bids(tender, lot)) {
                        var audit = get_audit_for_lot(tender, lot);
                        var init_date = find_initial_bid_date(tender.revisions || [], tender.bids.indexOf(bid), bid.id);
                                            
			if (['unsuccessful', 'cancelled'].indexOf(lot.status) !== -1) {
                            if (check_award_and_qualification(tender, bid, lot)) {
                                var date_terminated = date_normalize(lot.date);
                                var state = (get_month(bids_disclojure_date) !== get_month(date_terminated)) ? 3: 2;
                                emitter.lot(bid.owner, date_normalize(date_terminated), bid, lot, tender, audit, init_date, date_normalize(date_terminated), state);
                            }
                        } else if (['unsuccessful', 'cancelled'].indexOf(tender.status) !== -1) {
                            if (check_award_and_qualification(tender, bid, lot)) {
                                var date_terminated = date_normalize(tender.date);
                                var state = (get_month(bids_disclojure_date) !== get_month(date_terminated)) ? 3: 2;
                                emitter.lot(bid.owner, date_normalize(date_terminated), bid, lot, tender, audit, init_date, date_normalize(date_terminated), state);
                            }
			} else {
                            emitter.lot(bid.owner, date_normalize(bids_disclojure_date), bid, lot, tender,  audit, init_date, false, 4);
                        }
                    }
                } else { // is multilot end
                    if (check_tender_bids(tender, bid)) {
                        var audits = get_audit_for_tender(tender);
                        var init_date = find_initial_bid_date(tender.revisions || [], tender.bids.indexOf(bid), bid.id);
                        if ((tender.status === 'cancelled') && (tender.date > init_date)) {
                            return;
                        }
                        if (['unsuccessful', 'cancelled'].indexOf(tender.status) !== -1) {
                            var date_terminated = date_normalize(tender.date);
                            if (check_award_and_qualification(tender, bid, "")) {
                                var state = (get_month(bids_disclojure_date) === get_month(date_terminated)) ? 2 : 3;
                                emitter.tender(bid.owner, date_normalize(date_terminated), bid, tender, audits, init_date, date_normalize(date_terminated), state);
                            }
                        } else {
                            emitter.tender(bid.owner, date_normalize(bids_disclojure_date), bid, tender, audits, init_date, false, 4);
                        }
                    }
                }
                });
            } else {
                if(is_multilot) {
                    (bids || []).forEach(function(bid) {
                        var init_date = find_initial_bid_date(tender.revisions || [], tender.bids.indexOf(bid), bid.id);
                        bid.lotValues .forEach(function(value) {
                            tender.lots.forEach(function(lot) {
                                if (check_lot(tender, lot)) {
                                    if (value.relatedLot === lot.id) {
                                        var audit = get_audit_for_lot(tender, lot);
                                        emitter.lot(bid.owner, date_normalize(bids_disclojure_date), bid, lot, audit, init_date, false, false);
                                    }
                                }
                            });
                        });
                    });
                } else {
                    if (!(check_tender(tender))) { return; }
                    var audit = get_audit_for_tender(tender);
                    (bids || []).forEach(function(bid) {
                        var init_date = find_initial_bid_date(tender.revisions, tender.bids.indexOf(bid), bid.id);
                        emitter.tender(bid.owner, date_normalize(bids_disclojure_date), bid, tender, audit, init_date, false, false);
                    });
                }
            }
        }
    }
    emit_results(doc);
}
